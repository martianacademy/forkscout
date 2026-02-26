// src/channels/prepare-history.ts
// Shared history preparation pipeline for all channels.
//
// Any channel calls prepareHistory({ user, assistant, tool }) and gets back
// a clean ModelMessage[] that is safe to pass directly to the LLM:
//   1. Merge & sort by seq (preserves interleaved order from split storage)
//   2. Sanitize — validate AI SDK v6 schema, enforce tool-call/result pairing
//   3. Strip media — replace base64 images/screenshots with text placeholders
//   4. Cap tool results — extractive summarisation on oversized results
//   5. Trim to token budget — drop oldest messages until within budget

import { encode } from "gpt-tokenizer";
import { compressIfLong } from "@/utils/extractive-summary.ts";
import { sanitizeForPrompt } from "@/channels/chat-store.ts";
import type { ModelMessage } from "ai";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** A ModelMessage that may carry a `seq` field from split storage. */
export type StoredMessage = ModelMessage & { seq?: number };

export interface PrepareHistoryInput {
    /** User-role messages (may carry `seq` for ordering). */
    user: StoredMessage[];
    /** Assistant-role messages (may carry `seq` for ordering). */
    assistant: StoredMessage[];
    /** Tool-role messages (may carry `seq` for ordering). */
    tool?: StoredMessage[];
    /** System-role messages (rare; prepended after merge). */
    system?: StoredMessage[];
}

export interface PrepareHistoryOptions {
    /**
     * Maximum token budget for the history passed to the LLM.
     * Messages are dropped oldest-first until within budget.
     * Default: no limit.
     */
    tokenBudget?: number;
    /**
     * Maximum token count for a single tool-result before it is summarised.
     * Default: 4000
     */
    maxToolResultTokens?: number;
    /**
     * Maximum sentences to keep when summarising an oversized tool-result.
     * Default: 20
     */
    maxToolResultSentences?: number;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Prepare a chat history from split role arrays into a clean ModelMessage[]
 * ready to be passed directly to the LLM.
 *
 * @example
 * ```ts
 * const history = prepareHistory(
 *   { user: userMsgs, assistant: assistantMsgs, tool: toolMsgs },
 *   { tokenBudget: 12_000, maxToolResultTokens: 4_000 }
 * );
 * const result = await runAgent(config, { userMessage, chatHistory: history });
 * ```
 */
export function prepareHistory(
    input: PrepareHistoryInput,
    options: PrepareHistoryOptions = {}
): ModelMessage[] {
    const {
        tokenBudget,
        maxToolResultTokens = 4_000,
        maxToolResultSentences = 20
    } = options;

    // 1. Merge all role buckets tagging seq (use position within bucket as fallback)
    const all: StoredMessage[] = [
        ...tagSeq(input.user),
        ...tagSeq(input.assistant),
        ...tagSeq(input.tool ?? []),
        ...tagSeq(input.system ?? [])
    ];

    // 2. Sort by seq to restore original interleaved order
    all.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    // Strip seq before handing off (not part of ModelMessage schema)
    const merged: ModelMessage[] = all.map(
        ({ seq: _seq, ...msg }) => msg as ModelMessage
    );

    // 3. Validate AI SDK v6 schema & enforce tool-call/result pairing
    const sanitized = sanitizeForPrompt(merged);

    // 4. Strip media (base64 images / screenshots) — replace with text placeholders
    const stripped = stripMedia(sanitized);

    // 5. Cap oversized tool-results via extractive summarisation
    const capped =
        maxToolResultTokens > 0
            ? capToolResults(stripped, maxToolResultTokens, maxToolResultSentences)
            : stripped;

    // 6. Trim oldest messages to fit within token budget
    return tokenBudget != null ? trimTobudget(capped, tokenBudget) : capped;
}

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

/** Tag messages with their seq index if they don't already have one. */
function tagSeq(msgs: StoredMessage[]): StoredMessage[] {
    return msgs.map((m, i) => (m.seq != null ? m : { ...m, seq: i }));
}

/**
 * Replace base64 images and screenshots with a text placeholder.
 * The LLM already acted on them at the time — keeping raw bytes wastes tokens.
 *
 * Exported so agent/index.ts can use it directly when history arrives pre-merged.
 */
export function stripMedia(history: ModelMessage[]): ModelMessage[] {
    return history.map((msg) => {
        if (!Array.isArray(msg.content)) return msg;
        const stripped = (msg.content as any[]).map((part: any) => {
            if (part.type === "media" || part.type === "image") {
                return {
                    type: "text",
                    text: `[${part.mediaType ?? "media"} — stripped from history to save context]`
                };
            }
            // Strip media from inside tool-result content arrays
            if (
                (part.type === "tool-result" || part.type === "tool_result") &&
                Array.isArray(part.content)
            ) {
                return {
                    ...part,
                    content: part.content.map((inner: any) =>
                        inner.type === "media" || inner.type === "image"
                            ? {
                                type: "text",
                                text: `[${inner.mediaType ?? "media"} — stripped from history to save context]`
                            }
                            : inner
                    )
                };
            }
            return part;
        });
        return { ...msg, content: stripped } as ModelMessage;
    });
}

/**
 * Count approximate tokens for a single ModelMessage.
 * Tool call inputs and outputs are fully serialised — they can be large.
 */
function countTokens(msg: ModelMessage): number {
    if (typeof msg.content === "string") return encode(msg.content).length;
    if (Array.isArray(msg.content)) {
        return (msg.content as any[]).reduce((sum, part: any) => {
            if (part.type === "text") return sum + encode(part.text ?? "").length;
            if (part.type === "tool-call")
                return sum + encode(JSON.stringify(part.input ?? "")).length;
            if (part.type === "tool-result")
                return sum + encode(JSON.stringify(part.output ?? "")).length;
            return sum + 512; // images / files / unknown — flat estimate
        }, 0);
    }
    return 0;
}

/**
 * Cap individual tool-result parts to maxTokens using extractive summarisation.
 * Preserves meaning instead of hard-truncating.
 */
function capToolResults(
    history: ModelMessage[],
    maxTokens: number,
    maxSentences: number
): ModelMessage[] {
    const maxChars = maxTokens * 4;
    return history.map((msg): ModelMessage => {
        if (!Array.isArray(msg.content)) return msg;
        const capped = (msg.content as any[]).map((part: any) => {
            if (part.type !== "tool-result") return part;
            const out = part.output as any;
            let raw: string;
            if (typeof out === "string") raw = out;
            else if (out?.type === "text") raw = out.value ?? "";
            else if (out?.type === "json") raw = JSON.stringify(out.value ?? {});
            else if (out?.type === "content" && Array.isArray(out.value))
                raw = out.value.map((p: any) => p.text ?? JSON.stringify(p)).join(" ");
            else raw = JSON.stringify(out ?? "");
            if (encode(raw).length <= maxTokens) return part;
            return {
                ...part,
                output: {
                    type: "text",
                    value: compressIfLong(raw, maxChars, maxSentences)
                }
            };
        });
        return { ...msg, content: capped } as ModelMessage;
    });
}

/**
 * Drop oldest messages until total tokens fit within budget.
 * Always keeps at least the last 2 messages.
 * After trimming, drops any leading assistant/tool messages (AI SDK requires user-first).
 */
function trimTobudget(
    history: ModelMessage[],
    tokenBudget: number
): ModelMessage[] {
    let total = history.reduce((sum, m) => sum + countTokens(m), 0);
    const trimmed = [...history];

    while (total > tokenBudget && trimmed.length > 2) {
        total -= countTokens(trimmed.shift()!);
    }
    while (trimmed.length > 0 && (trimmed[0] as any).role !== "user") {
        trimmed.shift();
    }

    return trimmed;
}
