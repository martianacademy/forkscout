#!/usr/bin/env node
/**
 * Standalone Memory MCP Server
 *
 * Runs the forkscout memory as an independent MCP service.
 * No agent, no LLM, no Telegram — just the shared knowledge graph.
 *
 * Usage:
 *   tsx src/serve-memory.ts                    # default port 3211
 *   MEMORY_PORT=5000 tsx src/serve-memory.ts   # custom port
 *   pnpm serve:memory                          # via npm script
 *
 * Connect from VS Code / Cursor:
 *   { "type": "http", "url": "http://localhost:3211/mcp" }
 *
 * The memory file is shared with the agent at .forkscout/memory.json.
 * Both this server and the agent can read/write the same file —
 * whichever flushes last wins (single-user setup, not a problem).
 */

import { createServer } from 'http';
import { resolve } from 'path';
import { MemoryManager } from './memory';
import { createMemoryMcpServer, handleMcpRequest } from './mcp/memory-server';
import { AGENT_ROOT } from './paths';

const PORT = parseInt(process.env.MEMORY_PORT || '3211', 10);
const HOST = process.env.MEMORY_HOST || '0.0.0.0';
const STORAGE = resolve(process.env.MEMORY_STORAGE || resolve(AGENT_ROOT, '.forkscout'));
const OWNER = process.env.MEMORY_OWNER || 'Admin';

async function main() {
    // Initialize memory (same storage path as the agent)
    const memory = new MemoryManager({
        storagePath: STORAGE,
        ownerName: OWNER,
    });
    await memory.init();

    // Create MCP server over the shared memory
    createMemoryMcpServer(memory);

    // Periodic flush (every 30s)
    const flushInterval = setInterval(() => memory.flush(), 30_000);

    // Simple HTTP server — just routes /mcp
    const server = createServer(async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '';

        // Health check
        if (url === '/health' || url === '/') {
            const stats = memory.getStats();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', ...stats }));
            return;
        }

        // MCP endpoint
        if (url.startsWith('/mcp')) {
            const handled = await handleMcpRequest(req, res);
            if (handled) return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP or /health for status.' }));
    });

    server.listen(PORT, HOST, () => {
        const stats = memory.getStats();
        console.log(`\n🧠 Forkscout Memory MCP Server`);
        console.log(`   URL:      http://${HOST}:${PORT}/mcp`);
        console.log(`   Health:   http://${HOST}:${PORT}/health`);
        console.log(`   Storage:  ${STORAGE}/memory.json`);
        console.log(`   Entities: ${stats.entities}, Relations: ${stats.relations}, Exchanges: ${stats.exchanges}`);
        console.log(`\n   Add to VS Code settings.json:`);
        console.log(`   "mcp": { "servers": { "forkscout-memory": { "type": "http", "url": "http://localhost:${PORT}/mcp" } } }\n`);
    });

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n🧠 Flushing memory...');
        clearInterval(flushInterval);
        await memory.flush();
        server.close();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('Failed to start memory server:', err);
    process.exit(1);
});
