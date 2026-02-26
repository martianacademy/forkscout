// src/channels/self/index.ts
// Self channel — agent talks to itself on a cron schedule.
// Every job gets isolated history: .forkscout/chats/self-{name}.json
// Also exported: startCronJobs() so telegram can run cron in background.
//
// Jobs are loaded from .forkscout/self-jobs.json (gitignored, personal config).
// Format: array of SelfJobConfig objects — see src/config.ts for schema.

import type { Channel } from "@/channels/types.ts";
import type { AppConfig, SelfJobConfig } from "@/config.ts";
import { runAgent } from "@/agent/index.ts";
import { loadHistory, saveHistory } from "@/channels/chat-store.ts";
import { log } from "@/logs/logger.ts";
import { encode } from "gpt-tokenizer";
import type { ModelMessage } from "ai";
import cron from "node-cron";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const logger = log("self");

/** Path to the gitignored jobs file (next to auth.json) */
const JOBS_FILE = resolve(process.cwd(), ".forkscout", "self-jobs.json");

/** Load jobs from .forkscout/self-jobs.json + config.self.jobs, deduplicated by name. */
function loadJobs(config: AppConfig): SelfJobConfig[] {
    const configJobs: SelfJobConfig[] = config.self?.jobs ?? [];
    let fileJobs: SelfJobConfig[] = [];

    if (existsSync(JOBS_FILE)) {
        try {
            const raw = readFileSync(JOBS_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                fileJobs = parsed as SelfJobConfig[];
                logger.info(`Loaded ${fileJobs.length} job(s) from .forkscout/self-jobs.json`);
            } else {
                logger.error(".forkscout/self-jobs.json must be a JSON array — ignoring");
            }
        } catch (err: any) {
            logger.error("Failed to parse .forkscout/self-jobs.json:", err.message);
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

async function runJob(config: AppConfig, job: SelfJobConfig): Promise<void> {
    const sessionKey = `self-${job.name}`;
    const budget = config.self?.historyTokenBudget ?? 12000;
    const history = trimHistory(loadHistory(sessionKey), budget);

    logger.info(`Running job: ${job.name}`);

    try {
        const result = await runAgent(config, {
            userMessage: job.message,
            chatHistory: history,
            meta: { channel: "self", chatId: job.name },
        });

        const updated = trimHistory(
            [...history, { role: "user", content: job.message }, ...result.responseMessages],
            budget,
        );
        saveHistory(sessionKey, updated);

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
    } catch (err: any) {
        logger.error(`Job "${job.name}" failed:`, err.message ?? err);
    }
}

// ── Exported: start cron jobs (called from telegram channel or standalone) ───

export function startCronJobs(config: AppConfig): void {
    const jobs = loadJobs(config);

    if (jobs.length === 0) {
        logger.info("No self jobs configured — add jobs to .forkscout/self-jobs.json");
        return;
    }

    for (const job of jobs) {
        if (!cron.validate(job.schedule)) {
            logger.error(`Invalid cron expression for job "${job.name}": "${job.schedule}" — skipping`);
            continue;
        }
        cron.schedule(job.schedule, () => void runJob(config, job));
        logger.info(`Scheduled: "${job.name}" → ${job.schedule}`);
    }
}

// ── Channel interface ─────────────────────────────────────────────────────────

async function start(config: AppConfig): Promise<void> {
    startCronJobs(config);
    // Block forever — keep the process alive for cron scheduling
    await new Promise<never>(() => { /* never resolves */ });
}

export default {
    name: "self",
    start,
} satisfies Channel;
