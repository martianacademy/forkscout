// src/channels/adapter.ts — Shared channel adapter
// Standardised message handler factory for ALL channels.
// Each channel only provides: sendReply, sendTyping (optional), and channel identity.
// The adapter handles: compile (raw JSON), queue, abort, rate limit, history, streaming.

import type { AppConfig } from "@/config.ts";
import type { ModelMessage } from "ai";
import { streamAgent } from "@/agent/index.ts";
import { buildChatHistory, saveSemanticTurn, extractToolsUsed } from "@/channels/semantic-store.ts";
import { log } from "@/logs/logger.ts";

export interface ChannelAdapterOpts {
    /** Channel name for logging & session keys */
    channel: string;
    /** Max tokens in chat history. Default: 12000. */
    historyBudget?: number;
    /** Max reply length before chunking. Default: 4096. */
    maxReplyLength?: number;
    /** Send a text reply to the chat. */
    sendReply: (chatId: string, text: string) => Promise<void>;
    /** Optional typing indicator. */
    sendTyping?: (chatId: string) => Promise<void>;
}

interface QueueState {
    queue: Promise<void>;
    abort: AbortController;
}

/** Create a standardised message handler for any channel. */
export function createChannelHandler(opts: ChannelAdapterOpts) {
    const logger = log(opts.channel);
    const chatStates = new Map<string, QueueState>();
    const rateLimiter = new Map<string, { count: number; start: number }>();
    const budget = opts.historyBudget ?? 12000;
    const maxLen = opts.maxReplyLength ?? 4096;

    function checkRate(id: string, limit: number): boolean {
        if (limit <= 0) return true;
        const now = Date.now();
        const e = rateLimiter.get(id);
        if (!e || now - e.start > 60_000) { rateLimiter.set(id, { count: 1, start: now }); return true; }
        return ++e.count <= limit;
    }

    async function handle(
        config: AppConfig, rawMsg: unknown, chatId: string,
        senderName: string, role: "owner" | "admin" | "user",
        signal: AbortSignal,
    ): Promise<void> {
        const sessionKey = `${opts.channel}-${chatId}`;
        const compiled: ModelMessage = { role: "user", content: JSON.stringify(rawMsg) };
        const chatHistory = buildChatHistory(sessionKey);
        const roleTag = role === "owner" ? "OWNER" : role === "admin" ? "ADMIN" : "USER";
        const content = typeof compiled.content === "string" ? compiled.content : JSON.stringify(compiled.content);

        opts.sendTyping?.(chatId).catch(() => { });

        const stream = await streamAgent(config, {
            userMessage: `[${roleTag}] ${content}`,
            chatHistory, role,
            meta: { channel: opts.channel, chatId },
            abortSignal: signal,
        });

        let text = "";
        for await (const tok of stream.textStream) text += tok;
        const result = await stream.finalize();
        if (signal.aborted) return;

        const reply = result.text?.trim();
        if (!reply) { await opts.sendReply(chatId, "⚠️ No response from agent.").catch(() => { }); return; }

        if (reply.length <= maxLen) {
            await opts.sendReply(chatId, reply);
        } else {
            for (let i = 0; i < reply.length; i += maxLen) {
                await opts.sendReply(chatId, reply.slice(i, i + maxLen));
            }
        }
        saveSemanticTurn(sessionKey, {
            ts: Date.now(),
            user: `[${roleTag}] ${content}`,
            assistant: reply,
            tools: extractToolsUsed(result.responseMessages),
        });
    }

    /** Enqueue a message for sequential processing per chat. */
    function enqueue(
        config: AppConfig, rawMsg: unknown, chatId: string,
        senderId: string, senderName: string, role: "owner" | "admin" | "user",
        rateLimit = 15,
    ): void {
        if (role !== "owner" && !checkRate(senderId, rateLimit)) {
            logger.warn(`Rate limited ${senderId}`);
            opts.sendReply(chatId, "⏳ Too many messages. Please wait.").catch(() => { });
            return;
        }

        logger.info(`[${role}] ${senderName}: ${String(JSON.stringify(rawMsg)).slice(0, 80)}`);

        // Abort previous in-flight task for this chat
        const prev = chatStates.get(chatId);
        if (prev) prev.abort.abort();

        const controller = new AbortController();
        const prevQueue = prev?.queue ?? Promise.resolve();
        const next = prevQueue.then(() => {
            if (controller.signal.aborted) return;
            return handle(config, rawMsg, chatId, senderName, role, controller.signal)
                .catch(async (err) => {
                    if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("aborted"))) return;
                    logger.error(`Handler error ${chatId}:`, err);
                    await opts.sendReply(chatId, "⚠️ Something went wrong.").catch(() => { });
                });
        });
        chatStates.set(chatId, { queue: next, abort: controller });
    }

    return { enqueue };
}
