// src/channels/self/openai-compat.ts
// OpenAI-compatible /v1/chat/completions endpoint.
// Makes ForkScout agent act as a drop-in "model" for any OpenAI client or AI SDK.

import type { AppConfig } from "@/config.ts";
import type { ModelMessage } from "ai";
import { runAgent, streamAgent } from "@/agent/index.ts";
import { loadHistory, appendHistory, clearHistory } from "@/channels/chat-store.ts";
import { log } from "@/logs/logger.ts";

const logger = log("openai-compat");

const WEB_SESSION_KEY = "web";

// ── Types ────────────────────────────────────────────────────────────────────

interface OpenAIMessage {
    role: string;
    content: string;
}

interface ChatCompletionRequest {
    model?: string;
    messages: OpenAIMessage[];
    stream?: boolean;
    max_tokens?: number;
    temperature?: number;
}

// ── Shared CORS headers (must match self/index.ts) ──────────────────────────

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
}

function errorResponse(message: string, type: string, status: number): Response {
    return jsonResponse({ error: { message, type, code: null } }, status);
}

function sseChunk(data: unknown): string {
    return `data: ${JSON.stringify(data)}\n\n`;
}

// ── GET /v1/history ─────────────────────────────────────────────────────────

/** Return server-side chat history as simple {role, content}[] for the web client. */
export function handleGetHistory(): Response {
    const history = loadHistory(WEB_SESSION_KEY);
    // Convert ModelMessage[] to simple format the web client can use
    const simple = history
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any) => ({
            role: m.role as string,
            content: typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content)
                    ? (m.content as any[]).filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
                    : "",
        }))
        .filter((m) => m.content.length > 0);

    return jsonResponse({ messages: simple });
}

// ── DELETE /v1/history ──────────────────────────────────────────────────────

/** Clear server-side web chat history. */
export function handleClearHistory(): Response {
    clearHistory(WEB_SESSION_KEY);
    logger.info("web chat history cleared");
    return jsonResponse({ ok: true });
}

// ── GET /v1/models ──────────────────────────────────────────────────────────

export function handleListModels(): Response {
    return jsonResponse({
        object: "list",
        data: [
            {
                id: "forkscout",
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: "forkscout",
            },
        ],
    });
}

// ── POST /v1/chat/completions ───────────────────────────────────────────────

export async function handleChatCompletion(
    config: AppConfig,
    body: unknown,
    role: "owner" | "admin" | "user" | "self",
): Promise<Response> {
    const { messages, stream = true, model: modelName = "forkscout" } =
        body as ChatCompletionRequest;

    // ── Validate ─────────────────────────────────────────────────────────────
    if (!Array.isArray(messages) || messages.length === 0) {
        return errorResponse("messages array is required and must not be empty", "invalid_request_error", 400);
    }

    const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
    if (lastUserIdx < 0) {
        return errorResponse("At least one user message is required", "invalid_request_error", 400);
    }

    // ── Map to agent format ──────────────────────────────────────────────────
    const userMessage = messages[lastUserIdx].content;
    const chatHistory: ModelMessage[] = messages
        .slice(0, lastUserIdx)
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) as ModelMessage[];

    const requestId = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    logger.info(`[${role}] ${stream ? "stream" : "generate"}: ${userMessage.slice(0, 100)}`);

    // ── Non-streaming ────────────────────────────────────────────────────────
    if (!stream) {
        try {
            const result = await runAgent(config, {
                userMessage,
                chatHistory,
                role,
                meta: { channel: "web" },
            });

            // Save to server-side history
            appendHistory(WEB_SESSION_KEY, [
                { role: "user", content: userMessage } as ModelMessage,
                ...result.responseMessages,
            ]);

            return jsonResponse({
                id: requestId,
                object: "chat.completion",
                created,
                model: modelName,
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: result.text },
                    finish_reason: "stop",
                }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            });
        } catch (err: any) {
            logger.error("generate error:", err.message);
            return errorResponse(err.message ?? String(err), "server_error", 500);
        }
    }

    // ── Streaming (SSE) ──────────────────────────────────────────────────────
    try {
        const encoder = new TextEncoder();
        let closed = false;
        let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

        const enqueue = (data: Uint8Array) => {
            if (closed || !controllerRef) return;
            try { controllerRef.enqueue(data); } catch { closed = true; }
        };

        const closeStream = () => {
            if (closed || !controllerRef) return;
            closed = true;
            try { controllerRef.close(); } catch { /* already closed */ }
        };

        /** Send an OpenAI-format SSE text delta */
        const sendDelta = (content: string) => {
            enqueue(encoder.encode(sseChunk({
                id: requestId,
                object: "chat.completion.chunk",
                created,
                model: modelName,
                choices: [{ index: 0, delta: { content }, finish_reason: null }],
            })));
        };

        // Track whether we've sent any text yet (to add spacing around status lines)
        let hasText = false;
        let stepNum = 0;

        const { textStream, finalize } = await streamAgent(config, {
            userMessage,
            chatHistory,
            role,
            meta: { channel: "web" },
            onToolCall: (toolName, input) => {
                if (closed) return;
                stepNum++;
                // Format tool input concisely
                const inputStr = typeof input === "string"
                    ? input
                    : typeof input === "object" && input !== null
                        ? Object.values(input as Record<string, unknown>).filter(v => typeof v === "string").join(", ").slice(0, 100)
                        : "";
                // Parseable marker — frontend will detect and render as collapsible box
                sendDelta(`\n\n{{TOOL:${toolName}|${inputStr}}}\n\n`);
                hasText = true;
            },
            onThinkingStart: () => {
                if (closed) return;
                // Immediate signal — UI shows animated thinking container
                sendDelta(`\n\n{{THINKING_START}}\n`);
                hasText = true;
            },
            onThinkingDelta: (text) => {
                if (closed) return;
                // Stream reasoning tokens live — appears inside thinking container
                sendDelta(text);
            },
            onThinkingEnd: () => {
                if (closed) return;
                // Close the thinking block — UI collapses to pill
                sendDelta(`\n{{THINKING_END}}\n\n`);
                hasText = true;
            },
            onStepFinish: (hadToolCalls) => {
                // No-op — tool/thinking markers already sent
            },
        });

        const readable = new ReadableStream({
            async start(controller) {
                controllerRef = controller;

                try {
                    // 1. Role chunk
                    enqueue(encoder.encode(sseChunk({
                        id: requestId,
                        object: "chat.completion.chunk",
                        created,
                        model: modelName,
                        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
                    })));

                    // 2. Text deltas (interleaved with tool/thinking callbacks above)
                    for await (const token of textStream) {
                        if (!token || closed) continue;
                        sendDelta(token);
                        hasText = true;
                    }

                    // 3. Finalize agent run (internal bookkeeping + history save)
                    const result = await finalize();

                    // Save to server-side history
                    appendHistory(WEB_SESSION_KEY, [
                        { role: "user", content: userMessage } as ModelMessage,
                        ...result.responseMessages,
                    ]);

                    // 4. Stop chunk
                    enqueue(encoder.encode(sseChunk({
                        id: requestId,
                        object: "chat.completion.chunk",
                        created,
                        model: modelName,
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    })));

                    // 5. Done signal
                    enqueue(encoder.encode("data: [DONE]\n\n"));
                    closeStream();
                } catch (err: any) {
                    if (!closed) {
                        logger.error("stream error:", err.message);
                        enqueue(encoder.encode(sseChunk({
                            error: { message: err.message, type: "server_error" },
                        })));
                    } else {
                        logger.warn("stream aborted by client");
                    }
                    closeStream();
                }
            },
        });

        return new Response(readable, {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                ...CORS_HEADERS,
            },
        });
    } catch (err: any) {
        logger.error("stream setup error:", err.message);
        return errorResponse(err.message ?? String(err), "server_error", 500);
    }
}
