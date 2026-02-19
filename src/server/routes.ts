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
    createAgentUIStreamResponse,
    type UIMessage,
} from 'ai';
import { getReasoningSummary } from '../llm/reasoning';
import { buildFailureObservation } from '../memory';
import type { Agent } from '../agent';
import type { ChannelAuthStore } from '../channels/auth';
import type { TelegramBridge } from '../channels/telegram';
import { getConfig } from '../config';
import { readBody, sendJSON } from './http-utils';
import { detectChatContext, extractUserText } from './context';

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

    // Create a per-request ToolLoopAgent with all configuration
    const { agent: chatAgent, reasoningCtx } = await agent.createChatAgent({
        userText,
        ctx,
        onStepFinish: ({ toolCalls, toolResults }: any) => {
            if (toolCalls && toolCalls.length > 0) {
                console.log(`[Agent]: Step — ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`);
            }
            if (toolResults && toolResults.length > 0) {
                for (const tr of toolResults) {
                    const output = typeof (tr as any).output === 'string' ? (tr as any).output.slice(0, 100) : JSON.stringify((tr as any).output).slice(0, 100);
                    console.log(`  ↳ ${(tr as any).toolName}: ${output}`);
                }
            }
        },
        onFinish: ({ text, steps, usage }: any) => {
            const summary = getReasoningSummary(reasoningCtx);
            console.log(`[Agent]: Done (${steps?.length || 0} step(s), tier: ${summary.finalTier}, failures: ${summary.toolFailures}${summary.escalated ? ', ESCALATED' : ''})`);
            if (usage) {
                agent.getRouter().recordUsage(reasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
            }
            if (text) {
                agent.saveToMemory('assistant', text);
                console.log(`[Agent]: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`);
            }
            // Learn from failures
            const failureObs = buildFailureObservation(reasoningCtx, text || '');
            if (failureObs) {
                try { agent.getMemoryManager().recordSelfObservation(failureObs, 'failure-learning'); } catch { /* non-critical */ }
            }
        },
    });

    // Use createAgentUIStreamResponse — handles agent.stream() + UIMessage serialization
    const webResponse = await createAgentUIStreamResponse({
        agent: chatAgent,
        uiMessages: messages,
    });

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

    try {
        // Create a per-request ToolLoopAgent via the centralized factory
        const { agent: chatAgent, reasoningCtx } = await agent.createChatAgent({ userText, ctx });

        // agent.generate() returns the same shape as generateText()
        const { text, usage } = await chatAgent.generate({
            prompt: userText,
        });

        if (usage) {
            agent.getRouter().recordUsage(reasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
        }

        // Learn from failures
        const syncFailureObs = buildFailureObservation(reasoningCtx, text || '');
        if (syncFailureObs) {
            try { agent.getMemoryManager().recordSelfObservation(syncFailureObs, 'failure-learning'); } catch { /* non-critical */ }
        }

        agent.saveToMemory('assistant', text);
        sendJSON(res, 200, { response: text });
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
