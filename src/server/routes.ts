/**
 * API route handlers — all endpoint logic for the agent HTTP server.
 *
 * Each handler is a standalone async function receiving the request,
 * response, and shared dependencies (agent, channelAuth). Keeps
 * routing concerns separate from business logic.
 *
 * @module server/routes
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';
import {
    createAgentUIStream,
    createUIMessageStream,
    createUIMessageStreamResponse,
    type UIMessage,
} from 'ai';
import type { Agent } from '../agent';
import type { ChannelAuthStore } from '../channels/auth';
import type { TelegramBridge } from '../channels/telegram';
import { getConfig } from '../config';
import { requestTracker } from '../request-tracker';
import { readBody, sendJSON } from './http-utils';
import { detectChatContext, extractUserText } from './context';
import { createStepLogger, finalizeGeneration } from '../utils/generation-hooks';

// ── POST /api/chat — AI SDK UIMessage stream ───────────

export async function handleChatStream(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
    channelAuth: ChannelAuthStore,
): Promise<void> {
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

    agent.saveToMemory('user', userText, ctx);

    // Abort any in-flight request for this sender — new message takes priority
    const httpChatId = ctx.sender || ctx.channel;
    if (requestTracker.countByChat(ctx.channel, httpChatId) > 0) {
        console.log(`[HTTP]: New request from ${who} — aborting ${requestTracker.countByChat(ctx.channel, httpChatId)} active request(s)`);
        requestTracker.abortByChat(ctx.channel, httpChatId);
    }

    // Mutable ref so the step logger can write progress to the stream
    const writerRef: { current?: { write: (part: any) => void } } = {};

    // Create a per-request ToolLoopAgent with all configuration
    const { agent: chatAgent, reasoningCtx, modelId: chatModelId } = await agent.createChatAgent({
        userText,
        ctx,
        onStepFinish: createStepLogger({ writer: { write: (part: any) => writerRef.current?.write(part) } }),
        onFinish: async ({ text, steps, usage }: any) => {
            await finalizeGeneration({ text, steps, usage, reasoningCtx, modelId: chatModelId, channel: ctx.channel, agent, ctx, userMessage: userText });
        },
    });

    // Stream agent response directly
    const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
            writerRef.current = writer; // Enable progress markers
            const agentStream = await createAgentUIStream({
                agent: chatAgent,
                uiMessages: messages,
            });
            writer.merge(agentStream);
        },
    });
    const webResponse = createUIMessageStreamResponse({ stream: uiStream });

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
}

// ── POST /api/chat/sync — JSON response ────────────────

export async function handleChatSync(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
    channelAuth: ChannelAuthStore,
): Promise<void> {
    const body = JSON.parse(await readBody(req));
    const messages: UIMessage[] = body.messages || [];
    const ctx = detectChatContext(req, body, channelAuth);

    const userText = extractUserText(messages);
    if (!userText.trim()) {
        sendJSON(res, 400, { error: 'Message is required' });
        return;
    }

    agent.saveToMemory('user', userText, ctx);

    // Abort any in-flight sync request for this sender — new message takes priority
    const syncChatId = ctx.sender || ctx.channel;
    if (requestTracker.countByChat(ctx.channel, syncChatId) > 0) {
        console.log(`[HTTP/Sync]: New request — aborting ${requestTracker.countByChat(ctx.channel, syncChatId)} active request(s)`);
        requestTracker.abortByChat(ctx.channel, syncChatId);
    }

    try {
        // Create a per-request ToolLoopAgent via the centralized factory
        const { agent: chatAgent, reasoningCtx, modelId: syncModelId } = await agent.createChatAgent({ userText, ctx });

        const { text, usage, steps } = await chatAgent.generate({
            prompt: userText,
        });

        const { response: resolved } = await finalizeGeneration({
            text, steps, usage, reasoningCtx,
            modelId: syncModelId, channel: ctx.channel, agent, ctx,
            userMessage: userText,
        });

        sendJSON(res, 200, { response: resolved });
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        sendJSON(res, 500, { error: errMsg });
    }
}

// ── Admin & utility endpoints ──────────────────────────

export async function handleMemoryClear(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
    channelAuth: ChannelAuthStore,
): Promise<void> {
    const ctx = detectChatContext(req, undefined, channelAuth);
    if (!ctx.isAdmin) {
        sendJSON(res, 403, { error: 'Admin access required' });
        return;
    }
    await agent.getMemoryManager().clear();
    sendJSON(res, 200, { ok: true });
}

export async function handleHistory(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
    channelAuth: ChannelAuthStore,
): Promise<void> {
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
}

export function handleStatus(
    res: ServerResponse,
    agent: Agent,
    telegramBridge: TelegramBridge | null,
): void {
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
}

export function handleTools(res: ServerResponse, agent: Agent): void {
    sendJSON(res, 200, { tools: agent.getToolList() });
}

export async function handleGetConfig(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
    channelAuth: ChannelAuthStore,
): Promise<void> {
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
}

export async function handleSetConfig(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
    channelAuth: ChannelAuthStore,
): Promise<void> {
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
}

export async function handleModels(
    req: IncomingMessage,
    res: ServerResponse,
    agent: Agent,
): Promise<void> {
    const url = req.url || '';
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
}
