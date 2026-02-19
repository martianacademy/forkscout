/**
 * Structured Activity Logger — JSONL append-only log of all agent operations.
 *
 * Captures:
 *   - tool_call   → every tool invocation (name, args preview, result preview, duration)
 *   - llm_call    → every LLM completion (model, tier, tokens, cost)
 *   - chat        → every user message (channel, sender, preview)
 *   - self_edit   → source code edits (path, reason, success)
 *   - startup     → agent boot
 *   - shutdown    → agent stop
 *
 * Format: JSONL (one JSON object per line) — easy to tail, grep, and parse.
 * Location: .forkscout/activity.log
 * Rotation: auto-rotates at MAX_SIZE_BYTES (keeps one .prev backup).
 *
 * @module activity-log
 */

import { appendFileSync, statSync, renameSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { AGENT_ROOT } from './paths';
import { getConfig } from './config';

// ── Types ──────────────────────────────────────────────

export type ActivityEventType =
    | 'tool_call'
    | 'llm_call'
    | 'chat'
    | 'self_edit'
    | 'startup'
    | 'shutdown';

export interface ActivityEvent {
    /** ISO 8601 timestamp */
    ts: string;
    /** Event type */
    type: ActivityEventType;
    /** Event-specific data */
    data: Record<string, unknown>;
}

export interface ToolCallEvent {
    tool: string;
    args?: string;
    result?: string;
    durationMs?: number;
    success?: boolean;
}

export interface LLMCallEvent {
    model: string;
    tier: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    steps: number;
    channel?: string;
}

export interface ChatEvent {
    channel: string;
    sender?: string;
    isAdmin: boolean;
    preview: string;
}

export interface SelfEditEvent {
    path: string;
    reason: string;
    bytes: number;
    success: boolean;
}

// ── Constants ──────────────────────────────────────────

const LOG_DIR = resolve(AGENT_ROOT, '.forkscout');
const LOG_PATH = resolve(LOG_DIR, 'activity.log');
const LOG_PREV = resolve(LOG_DIR, 'activity.prev.log');
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // fallback — prefer getConfig().agent.activityLogMaxBytes

// ── Core Logger ──────────────────────────────────────────

/** Ensure the log directory exists */
function ensureDir(): void {
    if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
    }
}

/** Rotate log if it exceeds configured max size */
function rotateIfNeeded(): void {
    try {
        if (!existsSync(LOG_PATH)) return;
        const stats = statSync(LOG_PATH);
        const maxBytes = getConfig().agent.activityLogMaxBytes ?? MAX_SIZE_BYTES;
        if (stats.size >= maxBytes) {
            // Keep one generation of backup
            if (existsSync(LOG_PREV)) {
                // Delete old prev by overwriting
            }
            renameSync(LOG_PATH, LOG_PREV);
            console.log(`[Activity]: Log rotated (${(stats.size / 1024 / 1024).toFixed(1)} MB → activity.prev.log)`);
        }
    } catch (err) {
        console.warn(`[Activity]: Log rotation failed: ${err instanceof Error ? err.message : err}`);
    }
}

/** Write a single event to the log file */
function writeEvent(type: ActivityEventType, data: Record<string, unknown>): void {
    try {
        ensureDir();
        rotateIfNeeded();

        const event: ActivityEvent = {
            ts: new Date().toISOString(),
            type,
            data,
        };

        appendFileSync(LOG_PATH, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err) {
        // Never let logging break the agent
        console.error(`[Activity]: Write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

// ── Public API ─────────────────────────────────────────

/** Log a tool call */
export function logToolCall(tool: string, args?: Record<string, unknown>, result?: string, durationMs?: number): void {
    const argsPreview = args ? JSON.stringify(args).slice(0, 200) : undefined;
    const resultPreview = result ? result.slice(0, 300) : undefined;
    writeEvent('tool_call', {
        tool,
        args: argsPreview,
        result: resultPreview,
        durationMs,
    } satisfies ToolCallEvent);
}

/** Log an LLM completion */
export function logLLMCall(
    model: string,
    tier: string,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    steps: number,
    channel?: string,
): void {
    writeEvent('llm_call', {
        model,
        tier,
        inputTokens,
        outputTokens,
        cost: Math.round(cost * 1_000_000) / 1_000_000, // 6 decimal places
        steps,
        channel,
    } satisfies LLMCallEvent);
}

/** Log an incoming chat message */
export function logChat(channel: string, isAdmin: boolean, preview: string, sender?: string): void {
    writeEvent('chat', {
        channel,
        sender,
        isAdmin,
        preview: preview.slice(0, 200),
    } satisfies ChatEvent);
}

/** Log a self-edit */
export function logSelfEdit(path: string, reason: string, bytes: number, success: boolean): void {
    writeEvent('self_edit', {
        path,
        reason: reason.slice(0, 200),
        bytes,
        success,
    } satisfies SelfEditEvent);
}

/** Log agent startup */
export function logStartup(meta?: Record<string, unknown>): void {
    writeEvent('startup', {
        pid: process.pid,
        nodeVersion: process.version,
        ...meta,
    });
}

/** Log agent shutdown */
export function logShutdown(reason?: string): void {
    writeEvent('shutdown', {
        pid: process.pid,
        reason: reason || 'normal',
        uptime: Math.round(process.uptime()),
    });
}

// ── Reader (for API endpoint + agent tool) ─────────────

/**
 * Read the last N entries from the activity log.
 * Reads from the end of the file for efficiency.
 */
export function readRecentActivity(count = 50, filterType?: ActivityEventType): ActivityEvent[] {
    try {
        if (!existsSync(LOG_PATH)) return [];

        const content = readFileSync(LOG_PATH, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        // Parse from the end
        const events: ActivityEvent[] = [];
        for (let i = lines.length - 1; i >= 0 && events.length < count * 2; i--) {
            try {
                const event = JSON.parse(lines[i]) as ActivityEvent;
                if (!filterType || event.type === filterType) {
                    events.push(event);
                }
                if (events.length >= count) break;
            } catch {
                /* skip malformed lines */
            }
        }

        return events.reverse(); // chronological order
    } catch {
        return [];
    }
}

/** Get a human-readable summary of recent activity */
export function getActivitySummary(count = 20): string {
    const events = readRecentActivity(count);
    if (events.length === 0) return 'No activity recorded yet.';

    const lines: string[] = [`Last ${events.length} events:\n`];

    for (const e of events) {
        const time = e.ts.slice(11, 19); // HH:MM:SS
        switch (e.type) {
            case 'tool_call': {
                const d = e.data as unknown as ToolCallEvent;
                const dur = d.durationMs ? ` (${d.durationMs}ms)` : '';
                lines.push(`${time} 🔧 ${d.tool}${dur}`);
                break;
            }
            case 'llm_call': {
                const d = e.data as unknown as LLMCallEvent;
                lines.push(`${time} 🧠 ${d.model} [${d.tier}] ${d.inputTokens}→${d.outputTokens} tok $${d.cost.toFixed(4)}`);
                break;
            }
            case 'chat': {
                const d = e.data as unknown as ChatEvent;
                const who = d.sender || d.channel;
                lines.push(`${time} 💬 ${who}: ${d.preview.slice(0, 80)}`);
                break;
            }
            case 'self_edit': {
                const d = e.data as unknown as SelfEditEvent;
                const status = d.success ? '✅' : '❌';
                lines.push(`${time} ✏️ ${status} ${d.path} — ${d.reason.slice(0, 60)}`);
                break;
            }
            case 'startup':
                lines.push(`${time} 🚀 Agent started (PID ${e.data.pid})`);
                break;
            case 'shutdown':
                lines.push(`${time} 🛑 Agent stopped — ${e.data.reason} (uptime ${e.data.uptime}s)`);
                break;
        }
    }

    return lines.join('\n');
}

/** Get the log file path (for direct access) */
export function getLogPath(): string {
    return LOG_PATH;
}
