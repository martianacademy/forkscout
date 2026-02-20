/**
 * HTTP API server for the Forkscout Agent.
 *
 * Uses AI SDK v6 streamText + toUIMessageStreamResponse for proper
 * UIMessage streaming to the frontend.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Readable } from 'stream';
import {
    createAgentUIStream,
    createUIMessageStream,
    createUIMessageStreamResponse,
    type UIMessage,
} from 'ai';
import { Agent, type AgentConfig, type ChatContext, type ChatChannel } from './agent';
import type { ChannelAuthStore } from './channels/auth';
import { TelegramBridge } from './channels/telegram';
import { getConfig, watchConfig } from './config';
import { logChat, logShutdown, readRecentActivity, getActivitySummary, type ActivityEventType } from './activity-log';
import { requestTracker } from './request-tracker';
import { checkRateLimit } from './server/rate-limit';
import { createStepLogger, finalizeGeneration } from './utils/generation-hooks';


export interface ServerOptions {
    port?: number;
    host?: string;
    cors?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        let bytes = 0;
        req.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_048_576) {
                req.destroy();
                reject(new Error('Request body too large (max 1 MB)'));
                return;
            }
            body += chunk.toString();
        });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function setCors(req: IncomingMessage, res: ServerResponse) {
    const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://localhost:3210', 'http://127.0.0.1:3000', 'http://127.0.0.1:3210']);
    const origin = req.headers['origin'] || '';
    if (ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Channel, X-Sender, X-Admin-Secret');
    res.setHeader('Vary', 'Origin');
}

/**
 * Detect the chat context (who + through what medium) from the request.
 *
 * Admin detection (priority):
 *   1. Body field: { adminSecret: "xxx" } — matches ADMIN_SECRET env var
 *   2. Header: Authorization: Bearer xxx — matches ADMIN_SECRET env var
 *   3. Channel grant: channel auth store has an 'admin' grant for this channel+userId
 *   4. Auto-detect: localhost origin (frontend/terminal) = admin
 *   5. Everything else = guest
 *
 * Channel detection (priority):
 *   1. Explicit body fields: { channel, sender, metadata }
 *   2. Custom headers: X-Channel, X-Sender
 *   3. Auto-detect from User-Agent / Referer
 */
function detectChatContext(req: IncomingMessage, body?: any, channelAuth?: ChannelAuthStore): ChatContext {
    const adminSecret = getConfig().secrets.adminSecret;

    // ── Admin detection ──────────────────────────────
    let isAdmin = false;

    // 1. Explicit admin secret in body
    if (adminSecret && body?.adminSecret === adminSecret) {
        isAdmin = true;
    }
    // 2. Authorization: Bearer <secret> header
    else if (adminSecret) {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        if (token && token === adminSecret) {
            isAdmin = true;
        }
    }
    // 3. Localhost auto-detect — browser from localhost or local curl = admin
    //    BUT: if an explicit external channel is specified (telegram, whatsapp, etc.),
    //    the request is being proxied through a bridge — don't auto-promote.
    if (!isAdmin) {
        const explicitChannel = (body?.channel || req.headers['x-channel'] || '') as string;
        const EXTERNAL_CHANNELS = new Set(['telegram', 'whatsapp', 'discord', 'slack']);
        const isExplicitExternal = EXTERNAL_CHANNELS.has(explicitChannel.toLowerCase());

        if (!isExplicitExternal) {
            const referer = (req.headers['referer'] || '').toLowerCase();
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            const remoteAddr = req.socket?.remoteAddress || '';
            const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

            if (isLocal && (
                (referer.includes('localhost') && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari'))) ||
                ua.includes('curl') || ua.includes('httpie') || ua.includes('wget')
            )) {
                isAdmin = true;
            }
        }
    }

    // ── Build the context ────────────────────────────
    let ctx: ChatContext;

    // Explicit in body (highest priority — integrations set this)
    if (body?.channel || body?.sender) {
        ctx = {
            channel: (body.channel as ChatChannel) || 'api',
            sender: body.sender || undefined,
            isAdmin,
            metadata: body.metadata || undefined,
        };
    }
    // Custom headers
    else {
        const hChannel = req.headers['x-channel'] as string | undefined;
        const hSender = req.headers['x-sender'] as string | undefined;
        if (hChannel || hSender) {
            ctx = {
                channel: (hChannel as ChatChannel) || 'api',
                sender: hSender || undefined,
                isAdmin,
                metadata: body?.metadata || undefined,
            };
        } else {
            // Auto-detect from User-Agent / Referer
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            const referer = (req.headers['referer'] || '').toLowerCase();

            if (referer.includes('localhost') && (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari'))) {
                ctx = { channel: 'frontend', isAdmin };
            } else if (ua.includes('curl') || ua.includes('httpie') || ua.includes('wget')) {
                ctx = { channel: 'terminal', isAdmin };
            } else if (ua.includes('telegrambot')) {
                ctx = { channel: 'telegram', isAdmin };
            } else if (ua.includes('whatsapp')) {
                ctx = { channel: 'whatsapp', isAdmin };
            } else if (ua.includes('discord')) {
                ctx = { channel: 'discord', isAdmin };
            } else if (ua.includes('slackbot')) {
                ctx = { channel: 'slack', isAdmin };
            } else {
                ctx = { channel: 'unknown', isAdmin };
            }
        }
    }

    // 4. Channel auth grant check — if not already admin, check if this channel+userId
    //    has been granted admin/trusted by the admin via grant_channel_access tool.
    //    The userId comes from metadata.userId or metadata.telegramId etc.
    if (!ctx.isAdmin && channelAuth) {
        const userId = ctx.metadata?.userId || ctx.metadata?.telegramId
            || ctx.metadata?.chatId || ctx.metadata?.discordId
            || ctx.metadata?.phoneNumber || ctx.sender || '';
        if (userId) {
            const role = channelAuth.getRole(ctx.channel, userId);
            if (role === 'admin') {
                ctx.isAdmin = true;
            }
            // Track this session
            channelAuth.trackSession(ctx.channel, userId, ctx.sender, ctx.metadata);
        }
    }

    return ctx;
}



// Post-generation logic centralised in utils/generation-hooks.ts

/**
 * Extract the user's latest text from a UIMessage array.
 */
function extractUserText(messages: UIMessage[]): string {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return '';
    if (Array.isArray(lastUser.parts)) {
        return lastUser.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n');
    }
    return '';
}

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

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (opts.cors !== false) setCors(req, res);

        // CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Rate limiting
        if (!checkRateLimit(req, res)) return;

        const url = req.url || '';

        try {
            // ── POST /api/chat — AI SDK UIMessage stream ──
            if (req.method === 'POST' && url === '/api/chat') {
                const body = JSON.parse(await readBody(req));
                const messages: UIMessage[] = body.messages || [];
                const ctx = detectChatContext(req, body, channelAuth);

                const userText = extractUserText(messages);
                if (!userText.trim()) {
                    sendJSON(res, 400, { error: 'Message is required' });
                    return;
                }

                const who = ctx.sender ? `${ctx.sender} via ${ctx.channel}` : ctx.channel;
                console.log(`\n[${who}${ctx.isAdmin ? ' (admin)' : ' (guest)'}]: ${userText}`);
                logChat(ctx.channel, ctx.isAdmin, userText, ctx.sender);

                agent.saveToMemory('user', userText, ctx);

                // Track request for abort capability
                const { id: reqId, signal: abortSignal } = requestTracker.start('http-stream', ctx.sender);

                // Mutable ref so the step logger can write progress to the stream
                const writerRef: { current?: { write: (part: any) => void } } = {};

                // Create a per-request ToolLoopAgent via the centralized factory
                const { agent: chatAgent, reasoningCtx, modelId: chatModelId, preflight } = await agent.createChatAgent({
                    userText,
                    ctx,
                    onStepFinish: createStepLogger({ activityLog: true, writer: { write: (part: any) => writerRef.current?.write(part) } }),
                    onFinish: async ({ text, steps, usage }: any) => {
                        await finalizeGeneration({ text, steps, usage, reasoningCtx, modelId: chatModelId, channel: ctx.channel, agent, ctx, userMessage: userText });
                    },
                });

                // Stream with ack-first: write acknowledgment immediately, then merge agent stream
                const ack = preflight.acknowledgment;
                const uiStream = createUIMessageStream({
                    execute: async ({ writer }) => {
                        writerRef.current = writer; // Enable progress markers
                        // 1. Write acknowledgment text immediately so user sees it fast
                        if (ack) {
                            const ackId = `ack-${Date.now()}`;
                            writer.write({ type: 'text-start', id: ackId });
                            writer.write({ type: 'text-delta', delta: ack + '\n\n', id: ackId });
                            writer.write({ type: 'text-end', id: ackId });
                        }
                        // 2. Create and merge the agent stream (tool loop)
                        const agentStream = await createAgentUIStream({
                            agent: chatAgent,
                            uiMessages: messages,
                            abortSignal,
                        });
                        writer.merge(agentStream);
                    },
                });
                const webResponse = createUIMessageStreamResponse({ stream: uiStream });

                // Clean up tracker when response is sent
                res.on('finish', () => requestTracker.finish(reqId));
                res.on('close', () => requestTracker.finish(reqId));

                // Pipe the web Response to the Node.js ServerResponse
                const headers: Record<string, string> = {};
                webResponse.headers.forEach((value, key) => {
                    headers[key] = value;
                });
                res.writeHead(webResponse.status, headers);

                if (webResponse.body) {
                    Readable.fromWeb(webResponse.body as any).pipe(res);
                } else {
                    res.end();
                }
                return;
            }

            // ── POST /api/chat/sync — JSON response (non-streaming) ──
            if (req.method === 'POST' && url === '/api/chat/sync') {
                const body = JSON.parse(await readBody(req));
                const messages: UIMessage[] = body.messages || [];
                const ctx = detectChatContext(req, body, channelAuth);

                const userText = extractUserText(messages);
                if (!userText.trim()) {
                    sendJSON(res, 400, { error: 'Message is required' });
                    return;
                }

                agent.saveToMemory('user', userText, ctx);
                logChat(ctx.channel, ctx.isAdmin, userText, ctx.sender);

                // Track request for abort capability
                const { id: syncReqId, signal: syncAbortSignal } = requestTracker.start('http-sync', ctx.sender);

                try {
                    // Create a per-request ToolLoopAgent via the centralized factory
                    const { agent: syncAgent, reasoningCtx: syncReasoningCtx, modelId: syncModelId, preflight: syncPreflight } = await agent.createChatAgent({ userText, ctx });

                    // Quick tasks with no tools needed — return the ack directly
                    if (syncPreflight.effort === 'quick' && !syncPreflight.needsTools && syncPreflight.acknowledgment) {
                        agent.saveToMemory('assistant', syncPreflight.acknowledgment);
                        requestTracker.finish(syncReqId);
                        sendJSON(res, 200, { response: syncPreflight.acknowledgment });
                        return;
                    }

                    const { text, usage, steps } = await syncAgent.generate({
                        prompt: userText,
                        abortSignal: syncAbortSignal,
                    });

                    const { response: finalText } = await finalizeGeneration({
                        text, steps, usage, reasoningCtx: syncReasoningCtx,
                        modelId: syncModelId, channel: ctx.channel, agent, ctx,
                        userMessage: userText,
                    });

                    requestTracker.finish(syncReqId);
                    sendJSON(res, 200, { response: finalText });
                } catch (error) {
                    requestTracker.finish(syncReqId);
                    const errMsg = error instanceof Error ? error.message : String(error);
                    const isAborted = errMsg.includes('aborted') || errMsg.includes('abort');
                    sendJSON(res, isAborted ? 499 : 500, {
                        error: isAborted ? 'Request aborted' : errMsg,
                        aborted: isAborted,
                    });
                }
                return;
            }

            // ── POST /api/chat/abort — cancel active request(s) ── (admin only)
            if (req.method === 'POST' && url.startsWith('/api/chat/abort')) {
                const ctx = detectChatContext(req, undefined, channelAuth);
                if (!ctx.isAdmin) {
                    sendJSON(res, 403, { error: 'Admin access required' });
                    return;
                }
                const body = url === '/api/chat/abort' ? (() => { try { return JSON.parse(''); } catch { return {}; } })() : {};
                try {
                    const rawBody = await readBody(req);
                    Object.assign(body, rawBody ? JSON.parse(rawBody) : {});
                } catch { /* empty body = abort all */ }

                const targetId = body.id as string | undefined;

                if (targetId) {
                    // Abort specific request
                    const aborted = requestTracker.abort(targetId);
                    if (aborted) {
                        sendJSON(res, 200, { aborted: true, id: targetId });
                    } else {
                        sendJSON(res, 404, { error: `No active request with id: ${targetId}`, active: requestTracker.list() });
                    }
                } else {
                    // Abort ALL active requests
                    const count = requestTracker.abortAll();
                    sendJSON(res, 200, { aborted: true, count, message: `Aborted ${count} active request(s)` });
                }
                return;
            }

            // ── GET /api/chat/active — list active requests ──
            if (req.method === 'GET' && url === '/api/chat/active') {
                sendJSON(res, 200, { active: requestTracker.list(), count: requestTracker.size });
                return;
            }

            // ── POST /api/memory/clear ── (admin only)
            if (req.method === 'POST' && url === '/api/memory/clear') {
                const ctx = detectChatContext(req, undefined, channelAuth);
                if (!ctx.isAdmin) {
                    sendJSON(res, 403, { error: 'Admin access required' });
                    return;
                }
                await agent.getMemoryManager().clear();
                sendJSON(res, 200, { ok: true });
                return;
            }

            // ── GET /api/activity — activity log (admin only) ──
            if (req.method === 'GET' && url.startsWith('/api/activity')) {
                const ctx = detectChatContext(req, undefined, channelAuth);
                if (!ctx.isAdmin) {
                    sendJSON(res, 403, { error: 'Admin access required' });
                    return;
                }
                const params = new URL(url, `http://${req.headers.host}`).searchParams;
                const count = Math.min(parseInt(params.get('count') || '50'), 500);
                const filterType = params.get('type') as ActivityEventType | null;
                const format = params.get('format') || 'json';

                if (format === 'summary') {
                    sendJSON(res, 200, { summary: getActivitySummary(count) });
                } else {
                    const events = readRecentActivity(count, filterType || undefined);
                    sendJSON(res, 200, { events, count: events.length });
                }
                return;
            }

            // ── GET /api/history — conversation history from memory (admin only) ──
            if (req.method === 'GET' && url === '/api/history') {
                const ctx = detectChatContext(req, undefined, channelAuth);
                if (!ctx.isAdmin) {
                    sendJSON(res, 403, { error: 'Admin access required' });
                    return;
                }
                const memory = agent.getMemoryManager();
                const history = memory.getRecentHistory(100);
                sendJSON(res, 200, {
                    messages: history.map((m, i) => ({
                        id: `hist-${i}`,
                        role: m.role,
                        content: m.content,
                        timestamp: Date.now() - (history.length - i) * 1000,
                    })),
                });
                return;
            }

            // ── GET /api/status ──
            if (req.method === 'GET' && url === '/api/status') {
                const tools = agent.getToolList();
                const routerStatus = agent.getRouter().getStatus();
                sendJSON(res, 200, {
                    running: agent.getState().running,
                    tools: tools.map(t => t.name),
                    toolCount: tools.length,
                    activeRequests: requestTracker.list(),
                    router: routerStatus,
                    telegram: telegramBridge ? {
                        connected: telegramBridge.isRunning(),
                        bot: telegramBridge.getBotInfo()?.username || null,
                    } : null,
                });
                return;
            }

            // ── GET /api/tools ──
            if (req.method === 'GET' && url === '/api/tools') {
                sendJSON(res, 200, { tools: agent.getToolList() });
                return;
            }

            // ── GET /api/config ── (admin only)
            if (req.method === 'GET' && url === '/api/config') {
                const ctx = detectChatContext(req, undefined, channelAuth);
                if (!ctx.isAdmin) {
                    sendJSON(res, 403, { error: 'Admin access required' });
                    return;
                }
                const llmConfig = agent.getLLMClient().getConfig();
                const masked = llmConfig.apiKey
                    ? llmConfig.apiKey.slice(0, 4) + '…' + llmConfig.apiKey.slice(-4)
                    : undefined;
                sendJSON(res, 200, {
                    provider: llmConfig.provider,
                    model: llmConfig.model,
                    baseURL: llmConfig.baseURL,
                    apiKey: masked,
                    temperature: llmConfig.temperature,
                    maxTokens: llmConfig.maxTokens,
                });
                return;
            }

            // ── POST /api/config ── (admin only)
            if (req.method === 'POST' && url === '/api/config') {
                const ctx = detectChatContext(req, undefined, channelAuth);
                if (!ctx.isAdmin) {
                    sendJSON(res, 403, { error: 'Admin access required' });
                    return;
                }
                const body = JSON.parse(await readBody(req));
                const { provider, model, baseURL, apiKey, temperature, maxTokens } = body;
                if (!provider || !model) {
                    sendJSON(res, 400, { error: 'provider and model are required' });
                    return;
                }
                const patch: Record<string, unknown> = { provider, model };
                if (baseURL !== undefined) patch.baseURL = baseURL;
                if (apiKey !== undefined) patch.apiKey = apiKey;
                if (temperature !== undefined) patch.temperature = parseFloat(temperature);
                if (maxTokens !== undefined) patch.maxTokens = parseInt(maxTokens);

                const updated = agent.getLLMClient().updateConfig(patch as any);
                console.log(`[Config]: Provider changed → ${updated.provider} / ${updated.model}`);
                sendJSON(res, 200, {
                    provider: updated.provider,
                    model: updated.model,
                    baseURL: updated.baseURL,
                    temperature: updated.temperature,
                    maxTokens: updated.maxTokens,
                });
                return;
            }

            // ── GET /api/models?provider=X ──
            if (req.method === 'GET' && url.startsWith('/api/models')) {
                const params = new URL(url, `http://${req.headers.host}`).searchParams;
                const prov = params.get('provider') || 'openrouter';
                const currentConfig = agent.getLLMClient().getConfig();

                try {
                    let models: Array<{ id: string; name: string }> = [];

                    if (prov === 'openrouter') {
                        const r = await fetch('https://openrouter.ai/api/v1/models');
                        if (!r.ok) throw new Error(`OpenRouter API returned ${r.status}`);
                        const data: any = await r.json();
                        models = (data.data || []).map((m: any) => ({ id: m.id, name: m.name || m.id }));
                    } else if (prov === 'ollama') {
                        const ollamaBase = currentConfig.baseURL?.replace(/\/v1\/?$/, '') || 'http://localhost:11434';
                        const r = await fetch(`${ollamaBase}/api/tags`);
                        if (!r.ok) throw new Error(`Ollama API returned ${r.status}`);
                        const data: any = await r.json();
                        models = (data.models || []).map((m: any) => ({ id: m.name, name: m.name }));
                    } else if (prov === 'openai') {
                        const apiKey = currentConfig.apiKey || getConfig().secrets.openaiApiKey || '';
                        const r = await fetch('https://api.openai.com/v1/models', {
                            headers: { Authorization: `Bearer ${apiKey}` },
                        });
                        if (!r.ok) throw new Error(`OpenAI API returned ${r.status}`);
                        const data: any = await r.json();
                        models = (data.data || [])
                            .filter((m: any) => /^gpt|^o[0-9]|^chatgpt/.test(m.id))
                            .map((m: any) => ({ id: m.id, name: m.id }));
                    }

                    sendJSON(res, 200, { models });
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    sendJSON(res, 502, { error: errMsg, models: [] });
                }
                return;
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

    // ── Telegram bridge (auto-start if token is set) ──────────
    let telegramBridge: TelegramBridge | null = null;
    const tgToken = getConfig().secrets.telegramBotToken;
    if (tgToken) {
        telegramBridge = new TelegramBridge(agent, { token: tgToken });
        agent.setTelegramBridge(telegramBridge);
    }

    server.listen(port, host, async () => {
        console.log(`\n🌐 Forkscout Agent API running at http://${host}:${port}`);
        console.log(`   POST /api/chat         — AI SDK UIMessage stream`);
        console.log(`   POST /api/chat/sync    — JSON response`);
        console.log(`   POST /api/memory/clear — clear memory`);
        console.log(`   GET  /api/status       — agent status`);
        console.log(`   GET  /api/tools        — list tools`);
        console.log(`   POST /api/chat/abort   — abort active request(s)`);
        console.log(`   GET  /api/chat/active  — list active requests`);
        console.log(`   GET  /api/activity     — activity log\n`);

        // Start Telegram bridge after server is ready
        if (telegramBridge) {
            await telegramBridge.start();
        }
    });

    // Graceful shutdown — survival monitor handles signal trapping & emergency flush.
    // We just listen for its 'shutdown' callback to close the HTTP server and exit.
    const stopWatcher = watchConfig((freshCfg) => {
        agent.reloadConfig(freshCfg);
    });

    agent.getSurvival().onShutdown(async () => {
        console.log('\nSurvival monitor triggered shutdown...');
        logShutdown('survival_monitor');
        stopWatcher();
        if (telegramBridge) await telegramBridge.stop();
        await agent.stop();
        server.close();
        process.exit(0);
    });
}