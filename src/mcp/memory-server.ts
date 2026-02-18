/**
 * Memory MCP Server — exposes the agent's memory as an MCP service.
 *
 * Runs in-process on the same HTTP server (mounted at /mcp).
 * External clients (Cursor, Claude Desktop, other agents) can connect
 * to read/write the shared knowledge graph, search memory, and
 * manage active tasks — making every AI session contribute to a
 * shared understanding of the user's world.
 *
 * The agent itself still uses direct in-process calls (zero latency).
 * This server is the external window into the same MemoryStore.
 *
 * @module mcp/memory-server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { MemoryManager } from '../memory';
import type { IncomingMessage, ServerResponse } from 'http';

let mcpServer: McpServer | null = null;
let transport: StreamableHTTPServerTransport | null = null;

/** Initialize the MCP server with memory tools. Call once at startup. */
export function createMemoryMcpServer(memory: MemoryManager): McpServer {
    const server = new McpServer({
        name: 'forkscout-memory',
        version: '1.0.0',
    });

    // ── Knowledge tools ──────────────────────────────

    server.tool('save_knowledge', {
        fact: z.string().describe('Fact to store. Be specific and self-contained.'),
        category: z.string().optional().describe('Category: user-preference, project-context, decision, etc.'),
    }, async ({ fact, category }) => {
        await memory.saveKnowledge(fact, category);
        return { content: [{ type: 'text' as const, text: `Saved: ${fact}` }] };
    });

    server.tool('search_knowledge', {
        query: z.string().describe('Natural language search query.'),
        limit: z.number().optional().describe('Max results (default: 5).'),
    }, async ({ query, limit }) => {
        const results = await memory.searchKnowledge(query, limit || 5);
        const text = results.length === 0
            ? 'No relevant memories found.'
            : results.map((r, i) => `${i + 1}. [${r.relevance}%, ${r.source}] ${r.content}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
    });

    // ── Entity tools ─────────────────────────────────

    server.tool('add_entity', {
        name: z.string().describe('Entity name'),
        type: z.enum(['person', 'project', 'technology', 'preference', 'concept', 'file', 'service', 'organization', 'other']),
        facts: z.array(z.string()).describe('Facts about this entity'),
    }, async ({ name, type, facts }) => {
        const e = memory.addEntity(name, type, facts);
        return { content: [{ type: 'text' as const, text: `Entity "${e.name}" (${e.type}): ${e.facts.length} facts` }] };
    });

    server.tool('search_entities', {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default: 5)'),
    }, async ({ query, limit }) => {
        const hits = memory.getStore().searchEntities(query, limit || 5);
        const text = hits.length === 0
            ? 'No matching entities.'
            : hits.map(e => `• ${e.name} (${e.type}): ${e.facts.slice(0, 5).join('; ')}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
    });

    server.tool('get_entity', {
        name: z.string().describe('Entity name to look up'),
    }, async ({ name }) => {
        const e = memory.getEntity(name);
        if (!e) return { content: [{ type: 'text' as const, text: `Entity "${name}" not found.` }] };
        return { content: [{ type: 'text' as const, text: `${e.name} (${e.type}, seen ${e.accessCount}x):\n${e.facts.map(f => `  • ${f}`).join('\n')}` }] };
    });

    // ── Task tools ───────────────────────────────────

    server.tool('start_task', {
        title: z.string().describe('Short label (3-7 words)'),
        goal: z.string().describe('What you are trying to accomplish'),
        successCondition: z.string().optional().describe('How to know when done'),
    }, async ({ title, goal, successCondition }) => {
        const similar = memory.findSimilarTask(title, goal);
        if (similar && similar.status === 'running') {
            memory.heartbeatTask(similar.id);
            return { content: [{ type: 'text' as const, text: `⚡ Resuming "${similar.title}" (${similar.id}) — already running` }] };
        }
        const task = memory.createTask(title, goal, { successCondition });
        return { content: [{ type: 'text' as const, text: `✓ Started: "${task.title}" (${task.id})` }] };
    });

    server.tool('complete_task', {
        taskId: z.string().describe('Task ID'),
        result: z.string().optional().describe('Outcome summary'),
    }, async ({ taskId, result }) => {
        const task = memory.completeTask(taskId, result);
        if (!task) return { content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }] };
        const mins = Math.round((Date.now() - task.startedAt) / 60000);
        return { content: [{ type: 'text' as const, text: `✓ Completed "${task.title}" in ${mins}min` }] };
    });

    server.tool('check_tasks', {}, async () => {
        const summary = memory.getTaskSummary();
        const stats = memory.getStats();
        const text = summary
            ? `${summary}\n\nTotal: ${stats.totalTasks} (${stats.activeTasks} running)`
            : 'No active tasks.';
        return { content: [{ type: 'text' as const, text }] };
    });

    // ── Stats ────────────────────────────────────────

    server.tool('memory_stats', {}, async () => {
        const s = memory.getStats();
        const entities = memory.getAllEntities();
        const types = new Map<string, number>();
        for (const e of entities) types.set(e.type, (types.get(e.type) || 0) + 1);
        const breakdown = Array.from(types.entries()).map(([t, c]) => `  ${t}: ${c}`).join('\n');
        return {
            content: [{
                type: 'text' as const,
                text: `Entities: ${s.entities}\nRelations: ${s.relations}\nExchanges: ${s.exchanges}\nActive tasks: ${s.activeTasks}\n\nBreakdown:\n${breakdown || '  (none)'}`,
            }],
        };
    });

    mcpServer = server;
    return server;
}

/**
 * Handle an incoming HTTP request on the /mcp path.
 * Call this from the main HTTP server's request handler.
 */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!mcpServer) return false;

    const url = req.url || '';
    if (!url.startsWith('/mcp')) return false;

    // Initialize transport on first request (stateless mode)
    if (!transport) {
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless — no session tracking needed
        });
        await mcpServer.connect(transport);
        console.log('🔗 Memory MCP server connected (stateless)');
    }

    try {
        // Parse body for POST requests (transport expects pre-parsed body)
        let parsedBody: unknown;
        if (req.method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        }
        await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
        console.error('MCP request error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'MCP server error' }));
        }
    }
    return true;
}
