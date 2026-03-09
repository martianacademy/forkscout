// src/agent/llm-middleware.ts — Reusable wrapLanguageModel middleware for forkscout-agent
//
// Applied in build-params.ts via wrapLanguageModel({ model, middleware: [...] }).
// Order matters: middlewares wrap innermost-first so list them outermost-last.

import type {
    LanguageModelV3Middleware,
    LanguageModelV3StreamPart,
    LanguageModelV3ToolCall,
} from "@ai-sdk/provider";
import { censorSecrets } from "@/secrets/vault.ts";

// ─── XML Tool-Call Parser ────────────────────────────────────────────────────

/**
 * Parse <invoke name="toolName"><parameter name="k">v</parameter>...</invoke>
 * blocks from raw text and return structured tool calls + cleaned text.
 *
 * Handles the Anthropic-XML tool call format that MiniMax and some other
 * models emit as plain text instead of structured JSON tool calls.
 *
 * Returns:
 *   textBefore  — text preceding the first invoke block
 *   calls       — array of parsed tool calls
 *   remainder   — text after all invoke blocks (may contain a partial block)
 *   hasPartial  — true if the buffer ends with an incomplete <invoke … block
 */
function parseInvokeBlocks(text: string): {
    textBefore: string;
    calls: Array<{ toolName: string; input: string; id: string }>;
    remainder: string;
    hasPartial: boolean;
} {
    const INVOKE_RE = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    const PARAM_RE = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;

    const calls: Array<{ toolName: string; input: string; id: string }> = [];
    let lastIndex = 0;
    let textBefore = "";
    let match: RegExpExecArray | null;

    while ((match = INVOKE_RE.exec(text)) !== null) {
        if (calls.length === 0) textBefore = text.slice(0, match.index);
        const toolName = match[1];
        const inner = match[2];
        const args: Record<string, string> = {};
        let pm: RegExpExecArray | null;
        PARAM_RE.lastIndex = 0;
        while ((pm = PARAM_RE.exec(inner)) !== null) args[pm[1]] = pm[2];
        calls.push({
            toolName,
            input: JSON.stringify(args),
            id: `xml-${Date.now()}-${calls.length}`,
        });
        lastIndex = INVOKE_RE.lastIndex;
    }

    // Detect partial block: buffer ends with an unclosed <invoke
    const remainder = calls.length > 0 ? text.slice(lastIndex) : text;
    const hasPartial = /<invoke\b/.test(remainder) && !/<\/invoke>/.test(remainder);

    return { textBefore: calls.length > 0 ? textBefore : "", calls, remainder, hasPartial };
}

/**
 * XML→tool-call parser middleware.
 *
 * Intercepts models (MiniMax, some Qwen variants, etc.) that emit tool calls
 * as raw <invoke name="…"><parameter …>…</parameter></invoke> XML text instead
 * of structured JSON tool calls.
 *
 * For streaming: buffers text deltas, detects complete invoke blocks, emits
 *   proper `tool-call` stream parts and adjusts `finishReason` to `tool-calls`.
 * For non-streaming: scans result.content text parts for invoke blocks and
 *   replaces them with LanguageModelV3ToolCall content items.
 */
export const xmlToolCallMiddleware: LanguageModelV3Middleware = {
    specificationVersion: "v3",

    wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        const newContent: typeof result.content = [];
        let hadToolCalls = false;

        for (const part of result.content) {
            if (part.type !== "text") { newContent.push(part); continue; }
            const { textBefore, calls, remainder } = parseInvokeBlocks(part.text);
            if (calls.length === 0) { newContent.push(part); continue; }

            hadToolCalls = true;
            if (textBefore.trim()) newContent.push({ ...part, text: textBefore });
            for (const c of calls) {
                newContent.push({
                    type: "tool-call",
                    toolCallId: c.id,
                    toolName: c.toolName,
                    input: c.input,
                } satisfies LanguageModelV3ToolCall);
            }
            if (remainder.trim()) newContent.push({ ...part, text: remainder });
        }

        return {
            ...result,
            content: newContent,
            finishReason: (hadToolCalls ? "tool-calls" : result.finishReason) as import("@ai-sdk/provider").LanguageModelV3FinishReason,
        };
    },

    wrapStream: async ({ doStream }) => {
        const { stream, ...rest } = await doStream();

        // text-id for any plain-text block we open
        const TEXT_ID = "xml-text-0";
        let textOpen = false;
        let toolCallsEmitted = 0;

        // Buffer accumulates text-delta content.
        // We hold back text that might be the start of an <invoke block.
        let buffer = "";

        function flushBuffer(
            emit: (chunk: LanguageModelV3StreamPart) => void,
            forceAll: boolean,
        ) {
            if (!buffer) return;

            const { textBefore, calls, remainder, hasPartial } = parseInvokeBlocks(buffer);

            // Text before any invoke block — emit now
            const safeText = calls.length > 0 ? textBefore : (forceAll ? buffer : "");
            if (safeText) {
                if (!textOpen) { emit({ type: "text-start", id: TEXT_ID }); textOpen = true; }
                emit({ type: "text-delta", id: TEXT_ID, delta: safeText });
            }

            // Emit parsed tool calls
            for (const c of calls) {
                if (textOpen) { emit({ type: "text-end", id: TEXT_ID }); textOpen = false; }
                emit({ type: "tool-input-start", id: c.id, toolName: c.toolName });
                emit({ type: "tool-input-delta", id: c.id, delta: c.input });
                emit({ type: "tool-input-end", id: c.id });
                emit({ type: "tool-call", toolCallId: c.id, toolName: c.toolName, input: c.input } as LanguageModelV3StreamPart);
                toolCallsEmitted++;
            }

            // Update buffer to remainder
            if (forceAll) {
                // Emit remaining text too
                if (remainder && calls.length > 0) {
                    if (!textOpen) { emit({ type: "text-start", id: TEXT_ID }); textOpen = true; }
                    emit({ type: "text-delta", id: TEXT_ID, delta: remainder });
                }
                buffer = "";
            } else if (calls.length > 0) {
                // Keep remainder in buffer (may be partial invoke)
                buffer = remainder;
            } else if (!hasPartial) {
                // No invoke found, no partial starting — safe to flush all
                if (buffer) {
                    if (!textOpen) { emit({ type: "text-start", id: TEXT_ID }); textOpen = true; }
                    emit({ type: "text-delta", id: TEXT_ID, delta: buffer });
                }
                buffer = "";
            }
            // else: hasPartial=true and no complete invoke yet — keep buffering
        }

        const transformStream = new TransformStream<
            LanguageModelV3StreamPart,
            LanguageModelV3StreamPart
        >({
            transform(chunk, controller) {
                const emit = (c: LanguageModelV3StreamPart) => controller.enqueue(c);

                if (chunk.type === "text-start") {
                    // Absorb upstream text-start — we manage our own text block
                    return;
                }
                if (chunk.type === "text-delta") {
                    buffer += chunk.delta;
                    // Try to flush complete invoke blocks; hold back partial ones
                    flushBuffer(emit, false);
                    return;
                }
                if (chunk.type === "text-end") {
                    // Upstream text block closed — flush everything remaining
                    flushBuffer(emit, true);
                    if (textOpen) { emit({ type: "text-end", id: TEXT_ID }); textOpen = false; }
                    return;
                }
                if (chunk.type === "finish") {
                    // Flush any remaining buffered text
                    flushBuffer(emit, true);
                    if (textOpen) { emit({ type: "text-end", id: TEXT_ID }); textOpen = false; }
                    emit({
                        ...chunk,
                        finishReason: (toolCallsEmitted > 0 ? "tool-calls" : chunk.finishReason) as import("@ai-sdk/provider").LanguageModelV3FinishReason,
                    });
                    return;
                }
                emit(chunk);
            },
            flush(controller) {
                const emit = (c: LanguageModelV3StreamPart) => controller.enqueue(c);
                flushBuffer(emit, true);
                if (textOpen) { emit({ type: "text-end", id: TEXT_ID }); textOpen = false; }
            },
        });

        return { stream: stream.pipeThrough(transformStream), ...rest };
    },
};

// ─── Guardrails ───────────────────────────────────────────────────────────────

/**
 * Guardrails middleware — strips known secret values from ALL LLM text output.
 *
 * This is a last-resort safety net: even if a model echoes a secret it received
 * via a tool result or prompt, the secret value is replaced with [REDACTED] before
 * the text reaches any downstream handler (Telegram, logs, activity store, etc.).
 *
 * Tool results are censored separately in tool-wrappers.ts / call_tool.ts.
 * This layer covers the final generated text itself.
 */
export const guardrailsMiddleware: LanguageModelV3Middleware = {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        return {
            ...result,
            content: result.content?.map((part) =>
                part.type === "text"
                    ? { ...part, text: censorSecrets(part.text) }
                    : part
            ),
        };
    },

    wrapStream: async ({ doStream }) => {
        const { stream, ...rest } = await doStream();
        const transformStream = new TransformStream<
            LanguageModelV3StreamPart,
            LanguageModelV3StreamPart
        >({
            transform(chunk, controller) {
                if (chunk.type === "text-delta") {
                    controller.enqueue({ ...chunk, delta: censorSecrets(chunk.delta) });
                } else {
                    controller.enqueue(chunk);
                }
            },
        });
        return { stream: stream.pipeThrough(transformStream), ...rest };
    },
};
