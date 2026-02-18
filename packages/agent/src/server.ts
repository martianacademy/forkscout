/**
 * HTTP API server for the Forkscout Agent.
 *
 * Uses AI SDK v6 streamText + toUIMessageStreamResponse for proper
 * UIMessage streaming to the frontend.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Readable } from 'stream';
import {
    stepCountIs,
    convertToModelMessages,

    type UIMessage,
} from 'ai';
import { generateTextWithRetry, streamTextWithRetry } from './llm/retry';
import type { ModelTier } from './llm/router';
import { createReasoningContext, createPrepareStep, getReasoningSummary } from './llm/reasoning';
import { buildFailureObservation } from './memory/failure-memory';
import { Agent, type AgentConfig, type ChatContext, type ChatChannel } from './agent';
import type { ChannelAuthStore } from './channels/auth';
import { TelegramBridge } from './channels/telegram';
import { getConfig } from './config';
import { logToolCall, logLLMCall, logChat, logShutdown, readRecentActivity, getActivitySummary, type ActivityEventType } from './activity-log';


export interface ServerOptions {
    port?: number;
    host?: string;
    cors?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function sendJSON(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function setCors(res: ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Channel, X-Sender, X-Admin-Secret');
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
        if (opts.cors !== false) setCors(res);

        // CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

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

                // Build enriched system prompt with memory + urgent alerts
                const systemPrompt = await agent.buildSystemPrompt(userText, ctx);
                agent.saveToMemory('user', userText, ctx);

                // Stream with AI SDK v6 — tools filtered by access level
                const { model: chatModel, tier: chatTier, modelId: chatModelId, complexity } = agent.getModelForChat(userText);
                console.log(`[Router]: Using ${chatTier} tier (${chatModelId}) [${complexity.reason}]`);

                // Create reasoning context for inner loop
                const reasoningCtx = createReasoningContext(userText, complexity, chatTier as ModelTier, systemPrompt, agent.getRouter());

                const result = streamTextWithRetry({
                    model: chatModel,
                    system: systemPrompt,
                    messages: await convertToModelMessages(messages),
                    tools: agent.getToolsForContext(ctx),
                    stopWhen: stepCountIs(20),
                    prepareStep: createPrepareStep(reasoningCtx),
                    onStepFinish: ({ toolCalls, toolResults }) => {
                        if (toolCalls && toolCalls.length > 0) {
                            console.log(`[Agent]: Step — ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`);
                        }
                        if (toolResults && toolResults.length > 0) {
                            for (const tr of toolResults) {
                                const output = typeof (tr as any).output === 'string' ? (tr as any).output.slice(0, 100) : JSON.stringify((tr as any).output).slice(0, 100);
                                console.log(`  ↳ ${(tr as any).toolName}: ${output}`);
                            }
                        }
                        // Activity log: record each tool call
                        if (toolCalls && toolCalls.length > 0) {
                            for (let i = 0; i < toolCalls.length; i++) {
                                const tc = toolCalls[i] as any;
                                const tr = toolResults?.[i] as any;
                                const resultStr = tr?.output ? (typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output)) : undefined;
                                logToolCall(tc.toolName, tc.args, resultStr);
                            }
                        }
                    },
                    onFinish: ({ text, steps, usage }) => {
                        const summary = getReasoningSummary(reasoningCtx);
                        console.log(`[Agent]: Done (${steps?.length || 0} step(s), tier: ${summary.finalTier}, failures: ${summary.toolFailures}${summary.escalated ? ', ESCALATED' : ''})`);
                        // Record cost
                        let cost = 0;
                        if (usage) {
                            agent.getRouter().recordUsage(reasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
                            const pricing = agent.getRouter().getTierPricing(reasoningCtx.tier);
                            cost = ((usage.inputTokens || 0) * pricing.inputPer1M + (usage.outputTokens || 0) * pricing.outputPer1M) / 1_000_000;
                        }
                        // Activity log: record LLM call
                        logLLMCall(
                            chatModelId,
                            summary.finalTier,
                            usage?.inputTokens || 0,
                            usage?.outputTokens || 0,
                            cost,
                            steps?.length || 0,
                            ctx.channel,
                        );
                        if (text) {
                            agent.saveToMemory('assistant', text);
                            console.log(`[Agent]: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`);
                        }
                        // Learn from failures — store in knowledge graph
                        const failureObs = buildFailureObservation(reasoningCtx, text || '');
                        if (failureObs) {
                            try {
                                agent.getMemoryManager().recordSelfObservation(failureObs, 'failure-learning');
                                console.log(`[Reasoning]: Stored failure lesson in memory`);
                            } catch { /* non-critical */ }
                        }
                    },
                    onError: ({ error }) => {
                        console.error(`[Agent]: Stream error:`, error);
                    },
                });

                // Convert AI SDK Response to Node.js response
                const webResponse = result.toUIMessageStreamResponse();
                const headers: Record<string, string> = {};
                webResponse.headers.forEach((value, key) => {
                    headers[key] = value;
                });
                res.writeHead(200, headers);

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

                const systemPrompt = await agent.buildSystemPrompt(userText, ctx);
                agent.saveToMemory('user', userText, ctx);
                logChat(ctx.channel, ctx.isAdmin, userText, ctx.sender);

                try {
                    const { model: syncModel, tier: syncTier, modelId: syncModelId, complexity: syncComplexity } = agent.getModelForChat(userText);
                    console.log(`[Router]: Sync using ${syncTier} tier (${syncModelId}) [${syncComplexity.reason}]`);

                    // Create reasoning context for inner loop
                    const syncReasoningCtx = createReasoningContext(userText, syncComplexity, syncTier as ModelTier, systemPrompt, agent.getRouter());

                    const { text, usage, steps } = await generateTextWithRetry({
                        model: syncModel,
                        system: systemPrompt,
                        messages: await convertToModelMessages(messages),
                        tools: agent.getToolsForContext(ctx),
                        stopWhen: stepCountIs(20),
                        prepareStep: createPrepareStep(syncReasoningCtx),
                    });

                    // Record cost + activity log
                    const syncSummary = getReasoningSummary(syncReasoningCtx);
                    let cost = 0;
                    if (usage) {
                        agent.getRouter().recordUsage(syncReasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
                        const pricing = agent.getRouter().getTierPricing(syncReasoningCtx.tier);
                        cost = ((usage.inputTokens || 0) * pricing.inputPer1M + (usage.outputTokens || 0) * pricing.outputPer1M) / 1_000_000;
                    }
                    logLLMCall(syncModelId, syncSummary.finalTier, usage?.inputTokens || 0, usage?.outputTokens || 0, cost, steps?.length || 0, ctx.channel);

                    // Learn from failures
                    const syncFailureObs = buildFailureObservation(syncReasoningCtx, text || '');
                    if (syncFailureObs) {
                        try {
                            agent.getMemoryManager().recordSelfObservation(syncFailureObs, 'failure-learning');
                        } catch { /* non-critical */ }
                    }

                    agent.saveToMemory('assistant', text);
                    sendJSON(res, 200, { response: text });
                } catch (error) {
                    const errMsg = error instanceof Error ? error.message : String(error);
                    sendJSON(res, 500, { error: errMsg });
                }
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
        console.log(`   GET  /api/activity     — activity log\n`);

        // Start Telegram bridge after server is ready
        if (telegramBridge) {
            await telegramBridge.start();
        }
    });

    // Graceful shutdown — survival monitor handles signal trapping & emergency flush.
    // We just listen for its 'shutdown' callback to close the HTTP server and exit.
    agent.getSurvival().onShutdown(async () => {
        console.log('\nSurvival monitor triggered shutdown...');
        logShutdown('survival_monitor');
        if (telegramBridge) await telegramBridge.stop();
        await agent.stop();
        server.close();
        process.exit(0);
    });
}