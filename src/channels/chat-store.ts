// src/channels/chat-store.ts — Persists per-session chat history as a single sequential file.
//
// Storage layout:
//   .agents/chats/<sessionKey>/history.json  ← single file, all roles interleaved
//
// Each entry is a raw ModelMessage stored in exact chronological order.
// No split-by-role, no seq numbers — just a flat ordered array.
//
// Channels call:
//   loadHistory(key)                → read full ModelMessage[]
//   appendHistory(key, messages)    → append new messages to the array
//   saveHistory(key, messages)      → overwrite entire array (used after trim)
//   clearHistory(key)              → delete session
//
// Sanitisation (tool-call pairing, schema validation) is NOT done here —
// it happens at prompt-build time in prepare-history.ts, never on save/load.

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

function historyPath(sessionKey: string): string {
    return resolve(sessionDir(sessionKey), "history.json");
}

// ── Load ─────────────────────────────────────────────────────────────────────

/**
 * Load persisted history for a session.
 * Returns a flat ModelMessage[] in chronological order.
 *
 * Handles migration from:
 *   1. Legacy split-by-role files (user.json, assistant.json, tool.json)
 *   2. Legacy single flat file (.agents/chats/<key>.json)
 */
export function loadHistory(sessionKey: string): ModelMessage[] {
    const dir = sessionDir(sessionKey);
    const hPath = historyPath(sessionKey);

    // ── New format: history.json ────────────────────────────────────────────
    if (existsSync(hPath)) {
        try {
            const raw = readFileSync(hPath, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed as ModelMessage[];
        } catch (err) {
            logger.warn(`chat-store: failed to read history.json for ${sessionKey}: ${(err as Error).message}`);
        }
    }

    // ── Migration: split-by-role files → history.json ───────────────────────
    const splitRoles = ["user", "assistant", "tool", "system"] as const;
    const splitFiles = splitRoles.map(r => resolve(dir, `${r}.json`));
    const hasSplitFiles = splitFiles.some(f => existsSync(f));

    if (hasSplitFiles) {
        logger.info(`chat-store: migrating split-by-role files → history.json for ${sessionKey}`);
        const all: Array<{ seq: number } & Record<string, any>> = [];

        for (const role of splitRoles) {
            const path = resolve(dir, `${role}.json`);
            if (!existsSync(path)) continue;
            try {
                const raw = readFileSync(path, "utf-8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        if (entry && typeof entry === "object" && typeof entry.seq === "number") {
                            all.push(entry);
                        }
                    }
                }
            } catch { /* skip corrupted */ }
        }

        if (all.length > 0) {
            all.sort((a, b) => a.seq - b.seq);
            const messages: ModelMessage[] = all.map(({ seq: _seq, ...msg }) => msg as ModelMessage);
            saveHistory(sessionKey, messages);

            // Remove old split files
            for (const path of splitFiles) {
                try { if (existsSync(path)) rmSync(path, { force: true }); } catch { /* ignore */ }
            }

            return messages;
        }
    }

    // ── Migration: legacy flat file (.agents/chats/<key>.json) ──────────────
    const legacyFlat = resolve(CHATS_DIR, `${sessionKey}.json`);
    if (existsSync(legacyFlat)) {
        try {
            const raw = readFileSync(legacyFlat, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                logger.info(`chat-store: migrating legacy flat file → history.json for ${sessionKey}`);
                saveHistory(sessionKey, parsed as ModelMessage[]);
                try { rmSync(legacyFlat, { force: true }); } catch { /* ignore */ }
                return parsed as ModelMessage[];
            }
        } catch { /* skip corrupted */ }
    }

    return [];
}

// ── Save ─────────────────────────────────────────────────────────────────────

/** Overwrite entire history for a session. Used after trim operations. */
export function saveHistory(sessionKey: string, messages: ModelMessage[]): void {
    const dir = sessionDir(sessionKey);
    try { mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }

    try {
        writeFileSync(historyPath(sessionKey), JSON.stringify(messages, null, 2), "utf-8");
    } catch (err) {
        logger.error(`chat-store: failed to write history for ${sessionKey}:`, err);
    }
}

/** Append new messages to the end of existing history. */
export function appendHistory(sessionKey: string, messages: ModelMessage[]): void {
    if (messages.length === 0) return;
    const existing = loadHistory(sessionKey);
    saveHistory(sessionKey, [...existing, ...messages]);
}

// ── Clear ────────────────────────────────────────────────────────────────────

/** Clear history for a session — deletes the session folder and legacy flat file. */
export function clearHistory(sessionKey: string): void {
    try {
        rmSync(sessionDir(sessionKey), { recursive: true, force: true });
    } catch (err) {
        logger.error(`Failed to clear history for ${sessionKey}:`, err);
    }
    // Also clean up any legacy flat file
    const legacyFlat = resolve(CHATS_DIR, `${sessionKey}.json`);
    try { if (existsSync(legacyFlat)) rmSync(legacyFlat, { force: true }); } catch { /* ignore */ }
}

// ── Sanitize ─────────────────────────────────────────────────────────────────

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
                        if (ot === "text") {
                            if (typeof (output as any).value !== "string") {
                                const v = (output as any).value;
                                output = { type: "text", value: v == null ? "" : String(typeof v === "object" ? JSON.stringify(v) : v) };
                            }
                        } else if (ot === "json") {
                            if (!("value" in (output as any))) output = { type: "json", value: null };
                        } else if (ot === "error-text") {
                            if (typeof (output as any).value !== "string") output = { type: "error-text", value: String((output as any).value ?? "") };
                        } else if (ot === "error-json") {
                            if (!("value" in (output as any))) output = { type: "error-json", value: null };
                        } else if (ot === "execution-denied") {
                            const reason = (output as any).reason;
                            if (reason !== undefined && typeof reason !== "string") output = { type: "execution-denied", reason: String(reason) };
                        } else if (ot === "content") {
                            if (!Array.isArray((output as any).value)) output = { type: "json", value: (output as any).value ?? null };
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

    // Final guard: history must start with a user message.
    while (cleaned.length > 0 && (cleaned[0] as any).role !== "user") {
        cleaned.shift();
    }

    return cleaned;
}
