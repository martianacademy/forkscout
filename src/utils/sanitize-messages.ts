// src/utils/sanitize-messages.ts — Sanitize ModelMessage[] before passing to LLM
// Moved from chat-store.ts + prepare-history.ts (legacy storage files removed).

import type { ModelMessage } from "ai";

/**
 * Sanitize and normalise raw stored messages into valid ModelMessage[] just before
 * passing them to the LLM. Drops structurally invalid messages and enforces pairing:
 *   - tool-result messages without a preceding assistant tool-call are dropped
 *   - assistant messages with tool-calls that have no following tool-result are stripped of those calls
 */
export function sanitizeForPrompt(msgs: any[]): ModelMessage[] {
    const valid: ModelMessage[] = [];

    for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        if (!msg || typeof msg !== "object") continue;
        if (!["user", "assistant", "tool", "system"].includes(msg.role)) continue;
        if (msg.content === undefined || msg.content === null) continue;
        if (typeof msg.content !== "string" && !Array.isArray(msg.content)) continue;

        if (Array.isArray(msg.content)) {
            const allValid = (msg.content as any[]).every(
                (p: any) => p && typeof p === "object" && typeof p.type === "string"
            );
            if (!allValid) continue;

            if (msg.role === "tool") {
                const normalized = (msg.content as any[]).map((p: any) => {
                    if (p.type !== "tool-result") return null;
                    if (typeof p.toolCallId !== "string" || typeof p.toolName !== "string") return null;
                    let output = p.output;
                    if (output === undefined && p.result !== undefined) output = p.result;
                    if (output === undefined) return null;
                    const validOutputTypes = new Set(["text", "json", "execution-denied", "error-text", "error-json", "content"]);
                    if (typeof output !== "object" || output === null || !validOutputTypes.has((output as any).type)) {
                        output = typeof output === "string"
                            ? { type: "text", value: output }
                            : { type: "json", value: output ?? null };
                    } else {
                        const ot = (output as any).type;
                        if (ot === "text" && typeof (output as any).value !== "string") {
                            const v = (output as any).value;
                            output = { type: "text", value: v == null ? "" : String(typeof v === "object" ? JSON.stringify(v) : v) };
                        } else if (ot === "json" && !("value" in (output as any))) {
                            output = { type: "json", value: null };
                        } else if (ot === "error-text" && typeof (output as any).value !== "string") {
                            output = { type: "error-text", value: String((output as any).value ?? "") };
                        } else if (ot === "error-json" && !("value" in (output as any))) {
                            output = { type: "error-json", value: null };
                        } else if (ot === "execution-denied" && (output as any).reason !== undefined && typeof (output as any).reason !== "string") {
                            output = { type: "execution-denied", reason: String((output as any).reason) };
                        } else if (ot === "content" && !Array.isArray((output as any).value)) {
                            output = { type: "json", value: (output as any).value ?? null };
                        }
                    }
                    return { ...p, output };
                });
                if (normalized.some((p: any) => p === null)) continue;
                const prev = valid[valid.length - 1] as any;
                if (!prev || prev.role !== "assistant" || !Array.isArray(prev.content)) continue;
                const callIds = new Set(
                    (prev.content as any[]).filter((p: any) => p.type === "tool-call").map((p: any) => p.toolCallId)
                );
                const resultIds = (normalized as any[]).map((p: any) => p.toolCallId);
                if (!resultIds.every((id: string) => callIds.has(id))) continue;
                valid.push({ ...msg, content: normalized } as ModelMessage);
                continue;
            }
        }

        valid.push(msg as ModelMessage);
    }

    // Second pass: remove assistant messages whose tool-calls have no following tool-result.
    const cleaned: ModelMessage[] = [];
    for (let i = 0; i < valid.length; i++) {
        const msg = valid[i] as any;
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            const toolCalls = msg.content.filter((p: any) => p.type === "tool-call");
            if (toolCalls.length > 0) {
                const next = valid[i + 1] as any;
                const hasResult = next?.role === "tool" && Array.isArray(next.content) &&
                    toolCalls.every((tc: any) =>
                        next.content.some((tr: any) => tr.type === "tool-result" && tr.toolCallId === tc.toolCallId)
                    );
                if (!hasResult) {
                    const textParts = msg.content.filter((p: any) => p.type === "text");
                    if (textParts.length > 0) cleaned.push({ ...msg, content: textParts });
                    continue;
                }
            }
        }
        cleaned.push(msg);
    }

    while (cleaned.length > 0 && (cleaned[0] as any).role !== "user") cleaned.shift();
    return cleaned;
}

/**
 * Replace base64 images and screenshots with a text placeholder.
 * The LLM already acted on them — keeping raw bytes wastes tokens.
 */
export function stripMedia(history: ModelMessage[]): ModelMessage[] {
    return history.map((msg) => {
        if (!Array.isArray(msg.content)) return msg;
        const stripped = (msg.content as any[]).map((part: any) => {
            if (part.type === "media" || part.type === "image") {
                return { type: "text", text: `[${part.mediaType ?? "media"} — stripped from history to save context]` };
            }
            if ((part.type === "tool-result" || part.type === "tool_result") && Array.isArray(part.content)) {
                return {
                    ...part,
                    content: part.content.map((inner: any) =>
                        inner.type === "media" || inner.type === "image"
                            ? { type: "text", text: `[${inner.mediaType ?? "media"} — stripped from history to save context]` }
                            : inner
                    ),
                };
            }
            return part;
        });
        return { ...msg, content: stripped } as ModelMessage;
    });
}
