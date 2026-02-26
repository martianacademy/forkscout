// src/channels/chat-store.ts
// Persists per-session ModelMessage[] split by role into separate files.
// Used by all channels. Each channel prefixes its own session key:
//   telegram-<chatId>   → Telegram users
//   terminal-<username> → Terminal (OS user)
//
// Storage layout (per session):
//   .forkscout/chats/<sessionKey>/user.json      ← user messages
//   .forkscout/chats/<sessionKey>/assistant.json ← assistant messages
//   .forkscout/chats/<sessionKey>/tool.json      ← tool messages
//   .forkscout/chats/<sessionKey>/system.json    ← system messages (rare)
//
// Every stored entry has an extra `seq` field (0-based position in the
// original interleaved array) so loadHistory can reconstruct the correct order.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import type { ModelMessage } from "ai";
import { LOG_DIR } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";

const logger = log("chat-store");

const CHATS_DIR = resolve(LOG_DIR, "chats");

try {
    mkdirSync(CHATS_DIR, { recursive: true });
} catch { /* already exists */ }

// ── Paths ────────────────────────────────────────────────────────────────────

function sessionDir(sessionKey: string): string {
    return resolve(CHATS_DIR, sessionKey);
}

function rolePath(sessionKey: string, role: string): string {
    return resolve(sessionDir(sessionKey), `${role}.json`);
}

/** Legacy flat file path — used only for migration. */
function legacyPath(sessionKey: string): string {
    return resolve(CHATS_DIR, `${sessionKey}.json`);
}

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Load persisted history for a session.
 *
 * Reads the split role files, merges by `seq`, sanitizes, and returns
 * the interleaved ModelMessage[].
 *
 * Falls back to the legacy single-file format and migrates it automatically.
 */
export function loadHistory(sessionKey: string): ModelMessage[] {
    const dir = sessionDir(sessionKey);

    // ── Legacy flat file migration ───────────────────────────────────────────
    const legacy = legacyPath(sessionKey);
    if (!existsSync(dir) && existsSync(legacy)) {
        try {
            const raw = readFileSync(legacy, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                logger.warn(`chat-store: migrating legacy flat file → split format for ${sessionKey}`);
                saveHistory(sessionKey, parsed as ModelMessage[]);
                try { rmSync(legacy, { force: true }); } catch { /* ignore */ }
                return loadHistory(sessionKey);
            }
        } catch (err) {
            logger.warn(`chat-store: failed to migrate legacy file for ${sessionKey}: ${(err as Error).message}`);
        }
    }

    // ── New split format ─────────────────────────────────────────────────────
    if (!existsSync(dir)) return [];

    const roles = ["user", "assistant", "tool", "system"] as const;
    const all: Array<{ seq: number } & ModelMessage> = [];

    for (const role of roles) {
        const path = rolePath(sessionKey, role);
        if (!existsSync(path)) continue;
        try {
            const raw = readFileSync(path, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const entry of parsed) {
                    if (typeof entry?.seq === "number") {
                        const { seq, ...msg } = entry;
                        all.push({ seq, ...(msg as ModelMessage) });
                    }
                }
            }
        } catch (err) {
            logger.warn(`chat-store: failed to read ${role}.json for ${sessionKey}: ${(err as Error).message}`);
        }
    }

    if (all.length === 0) return [];

    // Sort by original position and return raw — no sanitization.
    // Sanitization happens at prompt-build time in the agent, not here.
    all.sort((a, b) => a.seq - b.seq);
    return all.map(({ seq: _seq, ...msg }) => msg as ModelMessage);
}

// ── Save ─────────────────────────────────────────────────────────────────────

/** Persist history for a session — splits messages by role into separate files. */
export function saveHistory(sessionKey: string, messages: ModelMessage[]): void {
    const dir = sessionDir(sessionKey);
    try {
        mkdirSync(dir, { recursive: true });
    } catch { /* already exists */ }

    const byRole = new Map<string, Array<{ seq: number } & ModelMessage>>();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const role = (msg as any).role as string;
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role)!.push({ seq: i, ...msg });
    }

    for (const [role, entries] of byRole) {
        try {
            writeFileSync(rolePath(sessionKey, role), JSON.stringify(entries, null, 2), "utf-8");
        } catch (err) {
            logger.error(`chat-store: failed to write ${role}.json for ${sessionKey}:`, err);
        }
    }

    // Remove role files that no longer have entries (e.g. all tool messages were trimmed)
    const allRoles = ["user", "assistant", "tool", "system"];
    for (const role of allRoles) {
        if (!byRole.has(role)) {
            const path = rolePath(sessionKey, role);
            try { if (existsSync(path)) rmSync(path, { force: true }); } catch { /* ignore */ }
        }
    }
}



/**
 * Sanitize and normalise raw stored messages into valid ModelMessage[] just before
 * passing them to the LLM. Storage is a pure raw log — this function is called
 * at prompt-build time only, never on save/load.
 *
 * Validate each message against the minimal AI SDK v6 ModelMessage shape.
 * Drops any message that is structurally invalid to prevent schema errors.
 * Also enforces pairing:
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

        // Content must be string or array
        if (typeof msg.content !== "string" && !Array.isArray(msg.content)) continue;

        if (Array.isArray(msg.content)) {
            // Every item in content array must have a `type` string field
            const allValid = (msg.content as any[]).every(
                (p: any) => p && typeof p === "object" && typeof p.type === "string"
            );
            if (!allValid) continue;

            // tool-result parts must have toolCallId + toolName + output (object)
            if (msg.role === "tool") {
                const normalized = (msg.content as any[]).map((p: any) => {
                    if (p.type !== "tool-result") return null; // invalid part
                    if (typeof p.toolCallId !== "string" || typeof p.toolName !== "string") return null;
                    // Normalize output to AI SDK v6 shape: must be an object, not string/primitive
                    let output = p.output;
                    if (output === undefined && p.result !== undefined) output = p.result; // migrate old field
                    if (output === undefined) return null;
                    // Ensure output is a valid AI SDK v6 outputSchema discriminated union.
                    // The schema requires specific shapes per type — all checked below.
                    const validOutputTypes = new Set(["text", "json", "execution-denied", "error-text", "error-json", "content"]);

                    if (typeof output !== "object" || output === null || !validOutputTypes.has((output as any).type)) {
                        // Not a valid discriminated union object — wrap it
                        output = typeof output === "string"
                            ? { type: "text", value: output }
                            : { type: "json", value: output ?? null };
                    } else {
                        // Valid type string, but value field might be wrong shape:
                        const ot = (output as any).type;
                        // "text" requires value: string
                        if (ot === "text") {
                            if (typeof (output as any).value !== "string") {
                                const v = (output as any).value;
                                output = { type: "text", value: v == null ? "" : String(typeof v === "object" ? JSON.stringify(v) : v) };
                            }
                        }
                        // "json" requires value field (any JSON value)
                        else if (ot === "json") {
                            if (!("value" in (output as any))) {
                                output = { type: "json", value: null };
                            }
                        }
                        // "error-text" requires value: string
                        else if (ot === "error-text") {
                            if (typeof (output as any).value !== "string") {
                                output = { type: "error-text", value: String((output as any).value ?? "") };
                            }
                        }
                        // "error-json" requires value field
                        else if (ot === "error-json") {
                            if (!("value" in (output as any))) {
                                output = { type: "error-json", value: null };
                            }
                        }
                        // "execution-denied" only requires optional reason: string
                        else if (ot === "execution-denied") {
                            const reason = (output as any).reason;
                            if (reason !== undefined && typeof reason !== "string") {
                                output = { type: "execution-denied", reason: String(reason) };
                            }
                        }
                        // "content" requires value: array — if invalid, downgrade to json
                        else if (ot === "content") {
                            if (!Array.isArray((output as any).value)) {
                                output = { type: "json", value: (output as any).value ?? null };
                            }
                        }
                    }
                    return { ...p, output };
                });
                if (normalized.some((p: any) => p === null)) {
                    logger.warn(`chat-store: dropping invalid tool message at index ${i}`);
                    continue;
                }
                // Verify the preceding assistant message has matching tool-calls
                const prev = valid[valid.length - 1] as any;
                if (!prev || prev.role !== "assistant" || !Array.isArray(prev.content)) {
                    logger.warn(`chat-store: dropping orphaned tool message at index ${i} (no preceding assistant)`);
                    continue;
                }
                const callIds = new Set(
                    (prev.content as any[])
                        .filter((p: any) => p.type === "tool-call")
                        .map((p: any) => p.toolCallId)
                );
                const resultIds = (normalized as any[]).map((p: any) => p.toolCallId);
                if (!resultIds.every((id: string) => callIds.has(id))) {
                    logger.warn(`chat-store: dropping tool message at index ${i} — toolCallIds don't match preceding assistant`);
                    continue;
                }
                valid.push({ ...msg, content: normalized } as ModelMessage);
                continue;
            }
        }

        valid.push(msg as ModelMessage);
    }

    // Second pass: remove assistant messages whose tool-calls have no following tool-result.
    // AI SDK v6 requires every tool-call to be answered — unpaired calls are invalid.
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
                    // Strip tool-calls, keep any text parts — or drop entirely if nothing left
                    const textParts = msg.content.filter((p: any) => p.type === "text");
                    if (textParts.length > 0) {
                        logger.warn(`chat-store: assistant at index ${i} has unpaired tool-calls — stripping calls, keeping text`);
                        cleaned.push({ ...msg, content: textParts });
                    } else {
                        logger.warn(`chat-store: dropping assistant at index ${i} — unpaired tool-calls, no text`);
                    }
                    continue;
                }
            }
        }
        cleaned.push(msg);
    }

    // Final guard: history must start with a user message.
    // Drop any leading assistant/tool/system messages that survived sanitization.
    while (cleaned.length > 0 && (cleaned[0] as any).role !== "user") {
        logger.warn(`chat-store: dropping leading ${(cleaned[0] as any).role} message — history must start with user`);
        cleaned.shift();
    }

    return cleaned;
}

/** Clear history for a session — deletes the session folder and legacy flat file. */
export function clearHistory(sessionKey: string): void {
    try {
        rmSync(sessionDir(sessionKey), { recursive: true, force: true });
    } catch (err) {
        logger.error(`Failed to clear history dir for ${sessionKey}:`, err);
    }
    try {
        rmSync(legacyPath(sessionKey), { force: true });
    } catch { /* ignore */ }
}
