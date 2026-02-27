// src/channels/self/index.ts — Self channel: agent talks to itself.
//
// Two sub-systems:
//   1. Cron jobs — scheduled autonomous tasks from forkscout.config.json or
//      .agent/self-jobs.json (gitignored).
//   2. HTTP trigger — POST /trigger { prompt, role? }
//      For tool-calling the agent on-demand (Task Offload Pattern, message_self tool).
//      GET /health → { ok: true } (used by scripts/safe-restart.sh smoke test)
//
// ALL self-channel activity shares ONE session key: "self"
// History lives at: .agent/chats/self/ (user.json, assistant.json, tool.json)
// This gives the agent full memory of everything it has ever done autonomously.
//
// Also exported: startCronJobs() so telegram can run cron in background.
//
// Config:
//   config.self.httpPort  — HTTP server port (0 = disabled). Default: 3200.
//   config.self.historyTokenBudget — max tokens per session. Default: 12000.
//   config.self.jobs — cron jobs array.

import type { Channel } from "@/channels/types.ts";
import type { AppConfig, SelfJobConfig } from "@/config.ts";
import { getConfig } from "@/config.ts";
import { runAgent } from "@/agent/index.ts";
import { loadHistory, saveHistory } from "@/channels/chat-store.ts";
import { log } from "@/logs/logger.ts";
import { encode } from "gpt-tokenizer";
import type { ModelMessage } from "ai";
import cron from "node-cron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { setupRegistry, registerJob, unregisterJob } from "@/channels/self/cron-registry.ts";
import { loadOrphanedMonitors, resumeMonitor } from "@/channels/self/progress-monitor.ts";
import { sendMessage } from "@/channels/telegram/api.ts";

const logger = log("self");

/** Path to the gitignored jobs file (next to auth.json) */
const JOBS_FILE = resolve(process.cwd(), ".agent", "self-jobs.json");

/** Remove a single job from self-jobs.json (used by run_once cleanup). */
function removeJobFromFile(name: string): void {
    if (!existsSync(JOBS_FILE)) return;
    try {
        const parsed = JSON.parse(readFileSync(JOBS_FILE, "utf-8"));
        const updated = Array.isArray(parsed) ? parsed.filter((j: any) => j.name !== name) : [];
        mkdirSync(resolve(process.cwd(), ".agent"), { recursive: true });
        writeFileSync(JOBS_FILE, JSON.stringify(updated, null, 4), "utf-8");
    } catch (err: any) {
        logger.error(`Failed to remove job "${name}" from file:`, err.message);
    }
}

/** Load jobs from .agent/self-jobs.json + config.self.jobs, deduplicated by name. */
function loadJobs(config: AppConfig): SelfJobConfig[] {
    const configJobs: SelfJobConfig[] = config.self?.jobs ?? [];
    let fileJobs: SelfJobConfig[] = [];

    if (existsSync(JOBS_FILE)) {
        try {
            const raw = readFileSync(JOBS_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                fileJobs = parsed as SelfJobConfig[];
                logger.info(`Loaded ${fileJobs.length} job(s) from .agent/self-jobs.json`);
            } else {
                logger.error(".agent/self-jobs.json must be a JSON array — ignoring");
            }
        } catch (err: any) {
            logger.error("Failed to parse .agent/self-jobs.json:", err.message);
        }
    }

    // Merge: file jobs take precedence over config jobs (deduplicate by name)
    const byName = new Map<string, SelfJobConfig>();
    for (const job of configJobs) byName.set(job.name, job);
    for (const job of fileJobs) byName.set(job.name, job); // overrides config
    return [...byName.values()];
}

// ── Token counting ────────────────────────────────────────────────────────────

function countTokens(msg: ModelMessage): number {
    if (typeof msg.content === "string") return encode(msg.content).length;
    if (Array.isArray(msg.content)) {
        return (msg.content as any[]).reduce((sum: number, p: any) => {
            if (p.type === "text" && typeof p.text === "string") return sum + encode(p.text).length;
            return sum + encode(JSON.stringify(p)).length;
        }, 0);
    }
    return 0;
}

// ── History helpers ───────────────────────────────────────────────────────────

function trimHistory(history: ModelMessage[], tokenBudget: number): ModelMessage[] {
    let total = history.reduce((sum, m) => sum + countTokens(m), 0);
    let trimmed = [...history];
    while (total > tokenBudget && trimmed.length > 2) {
        const removed = trimmed.shift()!;
        total -= countTokens(removed);
    }
    // Must always start with a user message
    while (trimmed.length > 0 && (trimmed[0] as any).role !== "user") {
        trimmed.shift();
    }
    return trimmed;
}

// ── Job runner ────────────────────────────────────────────────────────────────

/** Shared session key — all self-channel activity reads from and writes to this single history. */
const SELF_SESSION_KEY = "self";

async function runJob(config: AppConfig, job: SelfJobConfig): Promise<void> {
    const budget = config.self?.historyTokenBudget ?? 12000;
    const history = trimHistory(loadHistory(SELF_SESSION_KEY), budget);

    logger.info(`Running job: ${job.name}`);

    // Prefix with job name so the agent knows which cron fired
    const userMessage = `[CRON:${job.name}] ${job.message}`;

    try {
        const result = await runAgent(config, {
            userMessage,
            chatHistory: history,
            meta: { channel: "self", chatId: SELF_SESSION_KEY },
        });

        const updated = trimHistory(
            [...history, { role: "user", content: userMessage }, ...result.responseMessages],
            budget,
        );
        saveHistory(SELF_SESSION_KEY, updated);

        logger.info(`Job "${job.name}" done (${result.steps} steps): ${result.text.slice(0, 120)}`);

        // Optionally notify specific Telegram chats
        const chatIds = job.telegram?.chatIds ?? [];
        if (chatIds.length > 0) {
            const token = process.env.TELEGRAM_BOT_TOKEN;
            if (token) {
                const { sendMessage } = await import("@/channels/telegram/api.ts");
                for (const chatId of chatIds) {
                    await sendMessage(
                        token,
                        chatId,
                        `🤖 <b>${job.name}</b>\n\n${result.text}`,
                        "HTML",
                    );
                }
            }
        }

        // run_once: unschedule and remove from file after firing
        if (job.run_once) {
            logger.info(`Job "${job.name}" is run_once — removing after fire`);
            unregisterJob(job.name);
            removeJobFromFile(job.name);
        }
    } catch (err: any) {
        logger.error(`Job "${job.name}" failed:`, err.message ?? err);
        // Still clean up run_once jobs even if they error — prevent infinite retry loops
        if (job.run_once) {
            unregisterJob(job.name);
            removeJobFromFile(job.name);
        }
    }
}

// ── Exported: start cron jobs (called from telegram channel or standalone) ───

export function startCronJobs(config: AppConfig): void {
    // Wire up the registry so hot-registration from the tool works in this process.
    setupRegistry(config, runJob);

    const jobs = loadJobs(config);

    if (jobs.length === 0) {
        logger.info("No self jobs configured — add jobs to .agent/self-jobs.json");
        return;
    }

    for (const job of jobs) {
        if (!cron.validate(job.schedule)) {
            logger.error(`Invalid cron expression for job "${job.name}": "${job.schedule}" — skipping`);
            continue;
        }
        registerJob(job);
    }
}

// ── Channel interface ─────────────────────────────────────────────────────────

async function start(config: AppConfig): Promise<void> {
    startCronJobs(config);
    startHttpServer(config);
    // Block forever — keep the process alive for cron scheduling + HTTP server
    await new Promise<never>(() => { /* never resolves */ });
}

export default {
    name: "self",
    start,
} satisfies Channel;

// ════════════════════════════════════════════════════════════════════════════════
// HTTP TRIGGER SERVER
// Same history pipeline as Telegram: incoming message → history → agent → save.
// ════════════════════════════════════════════════════════════════════════════════

/** Per-session sequential queue — one request processed at a time per sessionKey. */
const httpQueues = new Map<string, Promise<void>>();

/**
 * POST /trigger
 * Body: { prompt: string, role?: "owner" | "admin" | "user" | "self", session_key?: string }
 * Response: { ok: true, text: string, steps: number }
 *
 * session_key behaviour:
 *   - omitted / "self": main chain — history loaded + passed to LLM. .agent/chats/self/
 *   - any other value: worker session — runs with empty history (prompt is self-contained).
 *     History is still SAVED after the run for audit. .agent/chats/self-{key}/
 *
 * Requests with the same session_key are serialised — never two concurrent runs on the same history.
 * Different session_keys run in parallel — each has its own queue.
 *
 * GET /health → { ok: true }
 */
export function startHttpServer(config: AppConfig): void {
    const port = config.self?.httpPort ?? 3200;
    if (port === 0) {
        logger.info("HTTP trigger server disabled (httpPort = 0)");
        return;
    }

    Bun.serve({
        port,
        async fetch(req) {
            const url = new URL(req.url);

            // ── Health check ─────────────────────────────────────────────────
            if (req.method === "GET" && url.pathname === "/health") {
                return json({ ok: true });
            }

            // ── Trigger ──────────────────────────────────────────────────────
            if (req.method === "POST" && url.pathname === "/trigger") {
                let body: unknown;
                try {
                    body = await req.json();
                } catch {
                    return json({ ok: false, error: "Invalid JSON body" }, 400);
                }

                const { prompt, role, session_key } = body as Record<string, unknown>;

                if (typeof prompt !== "string" || !prompt.trim()) {
                    return json({ ok: false, error: "prompt is required and must be a non-empty string" }, 400);
                }

                const resolvedRole: "owner" | "admin" | "user" | "self" =
                    role === "admin" ? "admin" : role === "user" ? "user" : role === "self" ? "self" : "owner";

                // Resolve session key — blank/missing → main chain; anything else → worker session
                const resolvedKey: string =
                    typeof session_key === "string" && session_key.trim() ? session_key.trim() : SELF_SESSION_KEY;

                // Serialise requests per session key — different keys run in parallel, same key is queued
                let resolve!: (value: { ok: true; text: string; steps: number } | { ok: false; error: string }) => void;
                const resultPromise = new Promise<{ ok: true; text: string; steps: number } | { ok: false; error: string }>(
                    (r) => { resolve = r as typeof resolve; }
                );

                const prev = httpQueues.get(resolvedKey) ?? Promise.resolve();
                const next = prev.then(async () => {
                    const cfg = getConfig();
                    resolve(await handleHttpMessage(cfg, resolvedKey, prompt.trim(), resolvedRole));
                });
                httpQueues.set(resolvedKey, next.catch(() => { }));

                const result = await resultPromise;
                return json(result, result.ok ? 200 : 500);
            }

            return json({ ok: false, error: "Not found" }, 404);
        },
        error(err) {
            logger.error("HTTP server error:", err.message);
            return json({ ok: false, error: err.message }, 500);
        },
    });

    logger.info(`HTTP trigger server listening on port ${port}`);
}

/**
 * Loads history (main chain only), runs agent, saves response.
 *
 * session_key behaviour:
 *   - SELF_SESSION_KEY ("self"): main chain — history is loaded and passed to the LLM.
 *   - any other key: worker session — chatHistory is empty (prompt is fully self-contained).
 *     History is still SAVED after the run so you have a full audit trail.
 *     Worker folders: .agent/chats/self-{key}/
 */
async function handleHttpMessage(
    config: AppConfig,
    sessionKey: string,
    prompt: string,
    role: "owner" | "admin" | "user" | "self"
): Promise<{ ok: true; text: string; steps: number } | { ok: false; error: string }> {
    const budget = config.self?.historyTokenBudget ?? 12000;

    // ── 1. Load history — main chain only; workers start with empty context ───
    const isMainChain = sessionKey === SELF_SESSION_KEY;
    const history: ModelMessage[] = isMainChain
        ? trimHistory(loadHistory(SELF_SESSION_KEY), budget)
        : [];

    const roleTag = role === "self" ? "SELF" : role === "owner" ? "OWNER" : role === "admin" ? "ADMIN" : "USER";
    const taggedPrompt = `[${roleTag}] ${prompt}`;

    // ── 2. Run agent ──────────────────────────────────────────────────────────
    const keyLabel = isMainChain ? "main" : `worker:${sessionKey}`;
    logger.info(`[${role}][${keyLabel}] ${prompt.slice(0, 80)}`);

    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
        result = await runAgent(config, {
            userMessage: taggedPrompt,
            chatHistory: history,
            role,
            meta: { channel: "self", chatId: sessionKey },
        });
    } catch (err: any) {
        logger.error(`HTTP trigger agent error [${keyLabel}]:`, err.message ?? err);
        return { ok: false, error: err.message ?? String(err) };
    }

    // ── 3. Save — always save for audit trail, regardless of main chain or worker
    const storageKey = isMainChain ? SELF_SESSION_KEY : `self-${sessionKey}`;
    const updated = trimHistory(
        [...history, { role: "user", content: taggedPrompt }, ...result.responseMessages],
        budget,
    );
    saveHistory(storageKey, updated);

    logger.info(`HTTP trigger done [${keyLabel}] (${result.steps} steps): ${result.text.slice(0, 120)}`);

    return { ok: true, text: result.text, steps: result.steps };
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// ORPHANED MONITOR RECOVERY
// On startup, checks for monitors that were running before a Bun restart.
// Sends a Telegram notification to all owners — does NOT auto-resume.
// User must explicitly say "resume monitor {batch}" or "cancel monitor {batch}".
// ════════════════════════════════════════════════════════════════════════════════

export async function checkOrphanedMonitors(config: AppConfig): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const ownerIds: number[] = config.telegram?.ownerUserIds ?? [];

    if (!token || ownerIds.length === 0) return;

    const orphans = loadOrphanedMonitors();
    if (orphans.length === 0) return;

    logger.warn(`Found ${orphans.length} orphaned monitor(s) from previous run`);

    const lines: string[] = [
        `⚠️ *Agent restarted* — found ${orphans.length} paused task batch(es).`,
        `Workers may still be running in the background.`,
        ``,
    ];

    for (const state of orphans) {
        // Best-effort: read plan.md for current progress
        let progress = "unknown";
        let taskSummary = "";
        try {
            if (existsSync(state.planFile)) {
                const content = readFileSync(state.planFile, "utf-8");
                const taskLines = [...content.matchAll(/^- \[(.)] `([^`]+)`/gm)];
                const total = taskLines.length;
                const done = taskLines.filter((m) => m[1] === "x").length;
                progress = `${done}/${total}`;
                taskSummary = taskLines
                    .map((m) => `  ${m[1] === "x" ? "\u2705" : "\u23f3"} ${m[2]}`)
                    .join("\n");
            } else {
                progress = "plan.md missing";
            }
        } catch { /* ignore */ }

        const startedAt = new Date(state.startedAt).toUTCString();
        lines.push(`*Batch: ${state.batchName}*`);
        lines.push(`• Progress: ${progress}`);
        lines.push(`• Started: ${startedAt}`);
        if (taskSummary) lines.push(taskSummary);
        lines.push(``);
    }

    lines.push(`To resume: tell me \"resume monitor {batch_name}\"`);
    lines.push(`To cancel: tell me "cancel monitor {batch_name}" (keeps task files)`);
    lines.push(`To delete everything: tell me "delete monitor {batch_name}"`);

    const msg = lines.join("\n");

    for (const chatId of ownerIds) {
        await sendMessage(token, chatId, msg, "Markdown").catch(() =>
            sendMessage(token, chatId, msg.replace(/[*`]/g, ""))
        );
    }
}
