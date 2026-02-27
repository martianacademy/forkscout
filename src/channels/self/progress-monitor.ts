// src/channels/self/progress-monitor.ts — Pure-JS progress monitor for parallel task batches.
//
// No LLM involved — this module runs a setInterval in the live process,
// reads plan.md every N seconds, deletes the previous Telegram message,
// sends a fresh snapshot, and fires the aggregator session once all tasks are ✅.
//
// Plan file format (.agent/tasks/{batchName}/plan.md):
//   ## Batch: batch-name
//
//   - [ ] `task-auth` — Analyse auth module
//   - [x] `task-db`   — Analyse database layer   ← worker flipped this to [x] when done
//   - [ ] `task-api`  — Analyse API routes
//
// Workers are responsible for flipping [ ] → [x] in plan.md when they finish their task.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import { sendMessage, deleteMessage } from "@/channels/telegram/api.ts";
import { LOG_DIR } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";

const logger = log("self:monitor");

/** Root folder for all task batches. */
export const TASKS_DIR = resolve(LOG_DIR, "tasks");

/** Persisted state folder — survives Bun restarts. */
const MONITORS_DIR = resolve(LOG_DIR, "monitors");

/** State saved to disk for each active monitor. */
export interface MonitorState {
    batchName: string;
    planFile: string;
    chatId: number;
    lastMessageId: number;   // best-effort; may be stale after restart
    aggregatorPrompt: string;
    httpPort: number;
    intervalSeconds: number;
    timeoutMinutes: number;
    startedAt: string;       // ISO timestamp
    timeoutAt: number;       // epoch ms
}

function monitorStatePath(batchName: string): string {
    return resolve(MONITORS_DIR, `${batchName}.json`);
}

function saveMonitorState(state: MonitorState): void {
    try {
        mkdirSync(MONITORS_DIR, { recursive: true });
        writeFileSync(monitorStatePath(state.batchName), JSON.stringify(state, null, 2), "utf-8");
    } catch (err: any) {
        logger.warn(`Failed to save monitor state for "${state.batchName}":`, err.message);
    }
}

function deleteMonitorState(batchName: string): void {
    try {
        const path = monitorStatePath(batchName);
        if (existsSync(path)) unlinkSync(path);
    } catch (err: any) {
        logger.warn(`Failed to delete monitor state for "${batchName}":`, err.message);
    }
}

/** Load all orphaned monitor states (from a previous process run). */
export function loadOrphanedMonitors(): MonitorState[] {
    if (!existsSync(MONITORS_DIR)) return [];
    try {
        return readdirSync(MONITORS_DIR)
            .filter((f) => f.endsWith(".json"))
            .flatMap((f) => {
                try {
                    const raw = readFileSync(resolve(MONITORS_DIR, f), "utf-8");
                    return [JSON.parse(raw) as MonitorState];
                } catch {
                    return [];
                }
            });
    } catch {
        return [];
    }
}

export interface StartMonitorOptions {
    batchName: string;
    /** Absolute path to plan.md */
    planFile: string;
    chatId: number;
    initialMessageId: number;
    token: string;
    /** Full prompt for the aggregator self-session fired when all tasks are done. */
    aggregatorPrompt: string;
    httpPort: number;
    intervalSeconds?: number;
    timeoutMinutes?: number;
    /** Internal — restored epoch ms timeout from saved state (used by resumeMonitor). */
    restoredTimeoutAt?: number;
}

interface MonitorEntry {
    timer: ReturnType<typeof setInterval>;
}

/** Active monitors keyed by batchName. */
const activeMonitors = new Map<string, MonitorEntry>();

/**
 * Start a progress monitor for a task batch.
 * Safe to call multiple times with the same batchName — duplicate calls are ignored.
 */
export function startProgressMonitor(opts: StartMonitorOptions): void {
    const {
        batchName,
        planFile,
        chatId,
        initialMessageId,
        token,
        aggregatorPrompt,
        httpPort,
        intervalSeconds = 3,
        timeoutMinutes = 30,
        restoredTimeoutAt,
    } = opts;

    if (activeMonitors.has(batchName)) {
        logger.warn(`Monitor for batch "${batchName}" already running — skipping`);
        return;
    }

    // Mutable ref for the last sent message_id — updated each tick and persisted
    let lastMessageId = initialMessageId;
    const resolvedTimeoutAt = restoredTimeoutAt ?? (Date.now() + timeoutMinutes * 60 * 1000);

    // ── Persist state so we can recover after a Bun restart ──────────────────
    const state: MonitorState = {
        batchName, planFile, chatId, lastMessageId,
        aggregatorPrompt, httpPort,
        intervalSeconds, timeoutMinutes,
        startedAt: new Date().toISOString(),
        timeoutAt: resolvedTimeoutAt,
    };
    saveMonitorState(state);

    const timer = setInterval(async () => {
        // ── Timeout ──────────────────────────────────────────────────────────
        if (Date.now() > resolvedTimeoutAt) {
            clearInterval(timer);
            activeMonitors.delete(batchName);
            deleteMonitorState(batchName);
            if (lastMessageId) await deleteMessage(token, chatId, lastMessageId);
            await sendMessage(token, chatId, `⏰ Task batch \`${batchName}\` timed out after ${timeoutMinutes} minutes.`);
            logger.warn(`Monitor for batch "${batchName}" timed out`);
            return;
        }

        // ── Plan file gone (batch cancelled or cleaned up) ───────────────────
        if (!existsSync(planFile)) {
            clearInterval(timer);
            activeMonitors.delete(batchName);
            deleteMonitorState(batchName);
            logger.info(`Monitor for batch "${batchName}" stopped — plan file removed`);
            return;
        }

        // ── Read plan ─────────────────────────────────────────────────────────
        let content: string;
        try {
            content = readFileSync(planFile, "utf-8");
        } catch (err: any) {
            logger.error(`Monitor: failed to read plan file for "${batchName}":`, err.message);
            return;
        }

        // ── Completion check — all task lines must be [x] ────────────────────
        const taskLines = content.match(/^- \[.\]/gm) ?? [];
        const allDone = taskLines.length > 0 && taskLines.every((l) => l === "- [x]");

        // ── Delete previous message ───────────────────────────────────────────
        if (lastMessageId) {
            await deleteMessage(token, chatId, lastMessageId);
            lastMessageId = 0;
            saveMonitorState({ ...state, lastMessageId });
        }

        if (allDone) {
            clearInterval(timer);
            activeMonitors.delete(batchName);
            deleteMonitorState(batchName);
            logger.info(`Monitor for batch "${batchName}" — all tasks done, firing aggregator`);

            fetch(`http://localhost:${httpPort}/trigger`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: aggregatorPrompt, role: "self", session_key: `agg-${batchName}` }),
            }).catch((err) => logger.error(`Aggregator trigger error for "${batchName}":`, err.message));

            return;
        }

        // ── Send fresh snapshot ───────────────────────────────────────────────
        const msgId = await sendMessage(token, chatId, content);
        if (msgId !== null) {
            lastMessageId = msgId;
            saveMonitorState({ ...state, lastMessageId });
        }

    }, intervalSeconds * 1000);

    activeMonitors.set(batchName, { timer });
    logger.info(`Progress monitor started for batch "${batchName}" (${intervalSeconds}s interval, ${timeoutMinutes}min timeout)`);
}

/**
 * Resume a monitor from persisted state after a Bun restart.
 * Tries to delete the old Telegram message (may fail gracefully), sends a fresh snapshot, restarts the interval.
 */
export async function resumeMonitor(savedState: MonitorState, token: string): Promise<void> {
    // Try to delete old message — ignore failure (it may already be gone)
    if (savedState.lastMessageId) {
        await deleteMessage(token, savedState.chatId, savedState.lastMessageId).catch(() => { });
    }

    // Send fresh snapshot to get a new message_id
    let newMessageId = 0;
    if (existsSync(savedState.planFile)) {
        const content = readFileSync(savedState.planFile, "utf-8");
        const msgId = await sendMessage(token, savedState.chatId, content);
        if (msgId !== null) newMessageId = msgId;
    }

    startProgressMonitor({
        batchName: savedState.batchName,
        planFile: savedState.planFile,
        chatId: savedState.chatId,
        initialMessageId: newMessageId,
        token,
        aggregatorPrompt: savedState.aggregatorPrompt,
        httpPort: savedState.httpPort,
        intervalSeconds: savedState.intervalSeconds,
        timeoutMinutes: savedState.timeoutMinutes,
        restoredTimeoutAt: savedState.timeoutAt,
    });
}

/** Cancel a monitor: stop if running, delete persisted state. */
export function cancelMonitor(batchName: string): void {
    stopMonitor(batchName);
    deleteMonitorState(batchName);
    logger.info(`Monitor for batch "${batchName}" cancelled and state deleted`);
}

/** Returns names of all currently active monitors. */
export function listActiveMonitors(): string[] {
    return [...activeMonitors.keys()];
}

/** Manually stop a monitor (e.g. if batch was cancelled). Does NOT delete persisted state — call cancelMonitor for full cleanup. */
export function stopMonitor(batchName: string): void {
    const entry = activeMonitors.get(batchName);
    if (entry) {
        clearInterval(entry.timer);
        activeMonitors.delete(batchName);
        logger.info(`Monitor for batch "${batchName}" stopped manually`);
    }
}
