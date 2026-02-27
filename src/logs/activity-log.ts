// src/logs/activity-log.ts — Persistent activity recorder
// Every message in, agent token, tool call, tool result, error gets written here.
// Format: NDJSON — one JSON object per line, easy to tail/grep/parse.
// File: .agents/activity.log (project root)

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(__dirname, "..", "..", ".agents");
const LOG_FILE = resolve(LOG_DIR, "activity.log");

// Ensure .agents/ dir always exists
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* already exists */ }

// ── Event types ───────────────────────────────────────────────────────────────

export type ActivityEventType =
    | "msg_in"        // user message received by a channel
    | "msg_out"       // full agent response sent back
    | "token"         // streamed token/chunk from the LLM
    | "tool_call"     // agent invoked a tool
    | "tool_result"   // tool returned a result
    | "info"          // general info log
    | "warn"          // warning
    | "error";        // error / exception

export interface ActivityEvent {
    type: ActivityEventType;
    /** Source module e.g. "telegram", "agent", "tools/web_search" */
    module?: string;
    /** Channel name: "telegram" | "terminal" | "voice" | "web" */
    channel?: string;
    /** Chat/session ID for multi-user channels */
    chatId?: number | string;
    /** Tool name for tool_call / tool_result events */
    tool?: string;
    /** Textual content — user message, agent response, token chunk, log message */
    text?: string;
    /** Tool input arguments */
    args?: unknown;
    /** Tool output */
    result?: unknown;
    /** Number of agent steps taken */
    steps?: number;
    /** Wall-clock duration in ms for timed events */
    durationMs?: number;
    /** Any extra context — freeform */
    [key: string]: unknown;
}

// ── Core writer ───────────────────────────────────────────────────────────────

/**
 * Append a single activity event to .agents/activity.log.
 * Never throws — logging must never crash the agent.
 */
export function logActivity(event: ActivityEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
    try {
        appendFileSync(LOG_FILE, line);
    } catch {
        // intentionally silent — log failure must not break the agent
    }
}

// ── Convenience helpers ───────────────────────────────────────────────────────

function pretty(val: unknown): string {
    return JSON.stringify(val, null, 2);
}

export const activity = {
    msgIn(channel: string, chatId: number | string | undefined, text: string) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[${channel}] ← ${chatId}`);
        console.log(text);
        console.log('─'.repeat(60));
        logActivity({ type: "msg_in", channel, chatId, text });
    },
    msgOut(channel: string, chatId: number | string | undefined, text: string, steps?: number, durationMs?: number) {
        console.log(`\n${'━'.repeat(60)}`);
        console.log(`[${channel}] → ${chatId}  (${steps ?? 0} steps · ${durationMs ?? 0}ms)`);
        console.log(text || "(empty response)");
        console.log('━'.repeat(60));
        logActivity({ type: "msg_out", channel, chatId, text, steps, durationMs });
    },
    token(chunk: string, channel?: string, chatId?: number | string) {
        logActivity({ type: "token", channel, chatId, text: chunk });
    },
    toolCall(tool: string, input: unknown, module = "agent", step?: number) {
        const stepTag = step !== undefined ? ` (step ${step})` : "";
        console.log(`\n[${module}]${stepTag} ⚙  ${tool}`);
        console.log(`  params: ${pretty(input)}`);
        logActivity({ type: "tool_call", module, tool, args: input, step });
    },
    toolResult(tool: string, output: unknown, durationMs?: number, module = "agent", step?: number) {
        const stepTag = step !== undefined ? ` (step ${step})` : "";
        const isError = output && typeof output === "object" && (output as any).success === false;
        if (isError) {
            console.error(`[${module}]${stepTag} ✗ ${tool} (${durationMs ?? "?"}ms)`);
            console.error(`  ERROR: ${(output as any).error ?? pretty(output)}`);
        } else {
            console.log(`[${module}]${stepTag} ✓ ${tool} (${durationMs ?? "?"}ms)`);
            console.log(`  ${pretty(output)}`);
        }
        logActivity({ type: "tool_result", module, tool, result: output, durationMs, step });
    },
    info(module: string, text: string) {
        logActivity({ type: "info", module, text });
    },
    warn(module: string, text: string) {
        logActivity({ type: "warn", module, text });
    },
    error(module: string, text: string, err?: unknown) {
        const detail = err instanceof Error
            ? `\n  cause: ${err.message}${err.stack ? `\n  stack: ${err.stack.split("\n").slice(1, 4).join(" | ")}` : ""}`
            : err !== undefined ? `\n  detail: ${JSON.stringify(err)}` : "";
        console.error(`[${module}] ✗ ${text}${detail}`);
        logActivity({ type: "error", module, text: text + (detail ? " | " + detail.trim() : "") });
    },
};

export { LOG_FILE, LOG_DIR };
