// src/channels/semantic-store.ts — Lightweight per-session semantic turn log
// Stores compressed turn summaries in JSONL. No embeddings needed.
// Used as the history context passed to the agent at the start of each new message.

import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import type { ModelMessage } from "ai";
import { LOG_DIR } from "@/logs/activity-log.ts";

const CHATS_DIR = resolve(LOG_DIR, "chats");

export interface SemanticTurn {
    ts: number;
    user: string;
    assistant: string;
    tools: string[];
}

function sessionPath(sessionKey: string): string {
    const dir = resolve(CHATS_DIR, sessionKey);
    mkdirSync(dir, { recursive: true });
    return resolve(dir, "semantic.jsonl");
}

/** Append a completed turn to the semantic log */
export function saveSemanticTurn(sessionKey: string, turn: SemanticTurn): void {
    try {
        appendFileSync(sessionPath(sessionKey), JSON.stringify(turn) + "\n", "utf-8");
    } catch { /* best effort */ }
}

/** Wipe all history for a session */
export function clearSemanticHistory(sessionKey: string): void {
    try {
        const p = sessionPath(sessionKey);
        if (existsSync(p)) writeFileSync(p, "", "utf-8");
    } catch { /* best effort */ }
}

/** Load all stored semantic turns for a session */
export function loadSemanticTurns(sessionKey: string): SemanticTurn[] {
    const p = sessionPath(sessionKey);
    if (!existsSync(p)) return [];
    try {
        return readFileSync(p, "utf-8")
            .split("\n")
            .filter(Boolean)
            .map(line => JSON.parse(line) as SemanticTurn);
    } catch { return []; }
}

/**
 * Build plain conversation history from the last N turns.
 * Returns raw user/assistant ModelMessage pairs — injected directly as chatHistory.
 * Agent sees this as normal conversation continuation.
 */
export function buildChatHistory(sessionKey: string, limit = 20): ModelMessage[] {
    const turns = loadSemanticTurns(sessionKey);
    if (turns.length === 0) return [];
    const recent = turns.slice(-limit);
    const messages: ModelMessage[] = [];
    for (const turn of recent) {
        messages.push({ role: "user", content: turn.user });
        messages.push({ role: "assistant", content: turn.assistant });
    }
    return messages;
}

/**
 * Build keyword-searched context from semantic turns (used by semantic_search_history tool).
 * Keeps last `limit` turns + keyword-boosted older turns with date/tool annotations.
 */
export function buildSemanticContext(
    sessionKey: string,
    currentMessage: string,
    limit = 12,
): ModelMessage[] {
    const turns = loadSemanticTurns(sessionKey);
    if (turns.length === 0) return [];

    const recent = turns.slice(-limit);

    // Simple keyword boost: also include older turns that share keywords with current message
    const keywords = currentMessage.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const older = turns.slice(0, -limit).filter(t =>
        keywords.some(kw => t.user.toLowerCase().includes(kw) || t.assistant.toLowerCase().includes(kw))
    ).slice(-3);

    const all = [
        ...(older.length > 0 ? older : []),
        ...recent,
    ];

    const messages: ModelMessage[] = [];
    for (const turn of all) {
        const date = new Date(turn.ts).toLocaleString();
        const toolNote = turn.tools.length > 0 ? ` [tools: ${turn.tools.join(", ")}]` : "";
        messages.push({ role: "user", content: `[${date}]${toolNote} ${turn.user}` });
        messages.push({ role: "assistant", content: turn.assistant });
    }
    return messages;
}

/** Extract a plain-text summary from the assistant's response (first 300 chars) */
export function summarizeAssistantResponse(responseMessages: ModelMessage[]): string {
    for (const msg of responseMessages) {
        if (msg.role === "assistant") {
            const text = typeof msg.content === "string"
                ? msg.content
                : (msg.content as any[]).find((p: any) => p.type === "text")?.text ?? "";
            if (text.trim()) return text.slice(0, 300).replace(/\n+/g, " ").trim();
        }
    }
    return "";
}

/** Extract unique tool names used in a set of response messages */
export function extractToolsUsed(responseMessages: ModelMessage[]): string[] {
    const tools = new Set<string>();
    for (const msg of responseMessages) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content as any[]) {
                if (part.type === "tool-call" && part.toolName) tools.add(part.toolName);
            }
        }
    }
    return [...tools];
}
