/**
 * Server entrypoint — creates the HTTP server, wires routes, starts Telegram bridge.
 *
 * This is the main startServer() function that boots the agent and
 * listens for HTTP requests. Delegates to route handlers in routes.ts.
 *
 * @module server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Agent, type AgentConfig } from '../agent';
import { TelegramBridge } from '../channels/telegram';
import { getConfig } from '../config';
import type { ServerOptions } from './http-utils';
import { setCors, sendJSON } from './http-utils';
import {
    handleChatStream,
    handleChatSync,
    handleMemoryClear,
    handleHistory,
    handleStatus,
    handleTools,
    handleGetConfig,
    handleSetConfig,
    handleModels,
} from './routes';

// Re-export for backward compat
export type { ServerOptions } from './http-utils';

/**
 * Start the agent HTTP server.
 *
 * Endpoints:
 *   POST /api/chat          — UIMessage stream (AI SDK v6 protocol)
 *   POST /api/chat/sync     — JSON response (no streaming)
 *   POST /api/memory/clear  — clear agent memory
 *   GET  /api/status        — agent status
 *   GET  /api/tools         — list registered tools
 *   GET  /api/config        — current LLM config
 *   POST /api/config        — update LLM config
 *   GET  /api/models        — fetch available models
 */
export async function startServer(config: AgentConfig, opts: ServerOptions = {}): Promise<void> {
    const port = opts.port || getConfig().agent.port;
    const host = opts.host || '0.0.0.0';

    const agent = new Agent(config);
    await agent.init();

    // Log router configuration
    const routerStatus = agent.getRouter().getStatus();
    console.log(`\n📊 Model Router:`);
    for (const [tier, info] of Object.entries(routerStatus.tiers)) {
        console.log(`   ${tier}: ${info.modelId} ($${info.inputPricePer1M}/$${info.outputPricePer1M} per 1M tokens)`);
    }
    console.log(`   Budget: $${routerStatus.budget.dailyLimitUSD}/day, $${routerStatus.budget.monthlyLimitUSD}/month`);

    const channelAuth = agent.getChannelAuth();

    // ── Telegram bridge (auto-start if token is set) ──
    let telegramBridge: TelegramBridge | null = null;
    const tgToken = getConfig().secrets.telegramBotToken;
    if (tgToken) {
        telegramBridge = new TelegramBridge(agent, { token: tgToken });
        agent.setTelegramBridge(telegramBridge);
    }

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (opts.cors !== false) setCors(res);

        // CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = req.url || '';

        try {
            if (req.method === 'POST' && url === '/api/chat') {
                return await handleChatStream(req, res, agent, channelAuth);
            }
            if (req.method === 'POST' && url === '/api/chat/sync') {
                return await handleChatSync(req, res, agent, channelAuth);
            }
            if (req.method === 'POST' && url === '/api/memory/clear') {
                return await handleMemoryClear(req, res, agent, channelAuth);
            }
            if (req.method === 'GET' && url === '/api/history') {
                return await handleHistory(req, res, agent, channelAuth);
            }
            if (req.method === 'GET' && url === '/api/status') {
                return handleStatus(res, agent, telegramBridge);
            }
            if (req.method === 'GET' && url === '/api/tools') {
                return handleTools(res, agent);
            }
            if (req.method === 'GET' && url === '/api/config') {
                return await handleGetConfig(req, res, agent, channelAuth);
            }
            if (req.method === 'POST' && url === '/api/config') {
                return await handleSetConfig(req, res, agent, channelAuth);
            }
            if (req.method === 'GET' && url.startsWith('/api/models')) {
                return await handleModels(req, res, agent);
            }

            // 404
            sendJSON(res, 404, { error: 'Not found' });
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error('Server error:', errMsg);
            if (!res.headersSent) {
                sendJSON(res, 500, { error: errMsg });
            }
        }
    });

    server.listen(port, host, async () => {
        console.log(`\n🌐 Forkscout Agent API running at http://${host}:${port}`);
        console.log(`   POST /api/chat         — AI SDK UIMessage stream`);
        console.log(`   POST /api/chat/sync    — JSON response`);
        console.log(`   POST /api/memory/clear — clear memory`);
        console.log(`   GET  /api/status       — agent status`);
        console.log(`   GET  /api/tools        — list tools\n`);

        // Start Telegram bridge after server is ready
        if (telegramBridge) {
            await telegramBridge.start();
        }
    });

    // Graceful shutdown — survival monitor handles signal trapping & emergency flush.
    agent.getSurvival().on('shutdown', async () => {
        console.log('\nSurvival monitor triggered shutdown...');
        if (telegramBridge) await telegramBridge.stop();
        await agent.stop();
        server.close();
        process.exit(0);
    });
}
