/**
 * MCP tool registration — registers memory tools on the McpServer.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MemoryStore } from './store.js';

export function registerTools(server: McpServer, store: MemoryStore): void {
    // ── Knowledge ────────────────────────────────────

    server.tool('save_knowledge', {
        fact: z.string().describe('Fact to store. Be specific and self-contained.'),
        category: z.string().optional().describe('Category: user-preference, project-context, decision, etc.'),
    }, async ({ fact, category }) => {
        const tagged = category ? `[${category}] ${fact}` : fact;
        const hits = store.searchEntities(fact, 1);
        if (hits.length > 0) store.addEntity(hits[0].name, hits[0].type, [tagged]);
        else store.addEntity(category || 'knowledge', 'concept', [tagged]);
        await store.flush();
        return { content: [{ type: 'text' as const, text: `Saved: ${fact}` }] };
    });

    server.tool('search_knowledge', {
        query: z.string().describe('Natural language search query.'),
        limit: z.number().optional().describe('Max results (default: 5).'),
    }, async ({ query, limit }) => {
        const results = store.searchKnowledge(query, limit || 5);
        const text = results.length === 0
            ? 'No relevant memories found.'
            : results.map((r, i) => `${i + 1}. [${r.relevance}%, ${r.source}] ${r.content}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
    });

    // ── Entities ─────────────────────────────────────

    server.tool('add_entity', {
        name: z.string().describe('Entity name'),
        type: z.enum(['person', 'project', 'technology', 'preference', 'concept', 'file', 'service', 'organization', 'other']),
        facts: z.array(z.string()).describe('Facts about this entity'),
    }, async ({ name, type, facts }) => {
        const e = store.addEntity(name, type, facts);
        await store.flush();
        return { content: [{ type: 'text' as const, text: `Entity "${e.name}" (${e.type}): ${e.facts.length} facts` }] };
    });

    server.tool('search_entities', {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default: 5)'),
    }, async ({ query, limit }) => {
        const hits = store.searchEntities(query, limit || 5);
        const text = hits.length === 0
            ? 'No matching entities.'
            : hits.map(e => `• ${e.name} (${e.type}): ${e.facts.slice(0, 5).join('; ')}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
    });

    server.tool('get_entity', {
        name: z.string().describe('Entity name to look up'),
    }, async ({ name }) => {
        const e = store.getEntity(name);
        if (!e) return { content: [{ type: 'text' as const, text: `Entity "${name}" not found.` }] };
        return { content: [{ type: 'text' as const, text: `${e.name} (${e.type}, seen ${e.accessCount}x):\n${e.facts.map(f => `  • ${f}`).join('\n')}` }] };
    });

    // ── Tasks ────────────────────────────────────────

    server.tool('start_task', {
        title: z.string().describe('Short label (3-7 words)'),
        goal: z.string().describe('What you are trying to accomplish'),
        successCondition: z.string().optional().describe('How to know when done'),
    }, async ({ title, goal, successCondition }) => {
        const similar = store.tasks.findSimilar(title, goal);
        if (similar && similar.status === 'running') {
            store.tasks.heartbeat(similar.id);
            return { content: [{ type: 'text' as const, text: `⚡ Resuming "${similar.title}" (${similar.id}) — already running` }] };
        }
        const task = store.tasks.create(title, goal, { successCondition });
        await store.flush();
        return { content: [{ type: 'text' as const, text: `✓ Started: "${task.title}" (${task.id})` }] };
    });

    server.tool('complete_task', {
        taskId: z.string().describe('Task ID'),
        result: z.string().optional().describe('Outcome summary'),
    }, async ({ taskId, result }) => {
        const task = store.tasks.complete(taskId, result);
        if (!task) return { content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }] };
        await store.flush();
        const mins = Math.round((Date.now() - task.startedAt) / 60000);
        return { content: [{ type: 'text' as const, text: `✓ Completed "${task.title}" in ${mins}min` }] };
    });

    server.tool('abort_task', {
        taskId: z.string().describe('Task ID'),
        reason: z.string().describe('Why the task was stopped'),
    }, async ({ taskId, reason }) => {
        const task = store.tasks.abort(taskId, reason);
        if (!task) return { content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }] };
        await store.flush();
        return { content: [{ type: 'text' as const, text: `✗ Aborted "${task.title}": ${reason}` }] };
    });

    server.tool('check_tasks', {}, async () => {
        const summary = store.tasks.summary();
        const text = summary
            ? `${summary}\n\nTotal: ${store.tasks.totalCount} (${store.tasks.runningCount} running)`
            : 'No active tasks.';
        return { content: [{ type: 'text' as const, text }] };
    });

    // ── Stats ────────────────────────────────────────

    server.tool('memory_stats', {}, async () => {
        const entities = store.getAllEntities();
        const types = new Map<string, number>();
        for (const e of entities) types.set(e.type, (types.get(e.type) || 0) + 1);
        const breakdown = Array.from(types.entries()).map(([t, c]) => `  ${t}: ${c}`).join('\n');
        return {
            content: [{
                type: 'text' as const,
                text: `Entities: ${store.entityCount}\nRelations: ${store.relationCount}\nExchanges: ${store.exchangeCount}\nActive tasks: ${store.tasks.runningCount}\n\nBreakdown:\n${breakdown || '  (none)'}`,
            }],
        };
    });
}
