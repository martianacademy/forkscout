// src/channels/chat-store.ts
// Persists per-session ModelMessage[] to .forkscout/chats/<sessionKey>.json
// Used by all channels. Each channel prefixes its own key:
//   telegram-<chatId>   → Telegram users
//   terminal-<username> → Terminal (OS user)

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import type { ModelMessage } from "ai";
import { LOG_DIR } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";

const logger = log("chat-store");

const CHATS_DIR = resolve(LOG_DIR, "chats");

try {
    mkdirSync(CHATS_DIR, { recursive: true });
} catch { /* already exists */ }

function chatPath(sessionKey: string): string {
    return resolve(CHATS_DIR, `${sessionKey}.json`);
}

/** Load persisted history for a session. Returns [] if no file exists yet. */
export function loadHistory(sessionKey: string): ModelMessage[] {
    try {
        const raw = readFileSync(chatPath(sessionKey), "utf-8");
        return JSON.parse(raw) as ModelMessage[];
    } catch {
        return [];
    }
}

/** Persist history for a session to disk (sync write — small files, fast). */
export function saveHistory(sessionKey: string, messages: ModelMessage[]): void {
    try {
        writeFileSync(chatPath(sessionKey), JSON.stringify(messages, null, 2), "utf-8");
    } catch (err) {
        logger.error(`Failed to save history for ${sessionKey}:`, err);
    }
}

/** Clear history for a session — deletes the file. */
export function clearHistory(sessionKey: string): void {
    try {
        rmSync(chatPath(sessionKey), { force: true });
    } catch (err) {
        logger.error(`Failed to clear history for ${sessionKey}:`, err);
    }
}
