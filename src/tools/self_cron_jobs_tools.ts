// src/tools/self_cron_job.ts
// Manage cron jobs in .agent/self-jobs.json — list, add, remove, run now.

import { tool } from "ai";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { SelfJobConfig } from "@/config.ts";
import { getConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";
import { registerJob, unregisterJob } from "@/channels/self/cron-registry.ts";

export const IS_BOOTSTRAP_TOOL = false;

const logger = log("tool:self_cron_job");
const JOBS_FILE = resolve(process.cwd(), ".agent", "self-jobs.json");

function readJobs(): SelfJobConfig[] {
    if (!existsSync(JOBS_FILE)) return [];
    try {
        const parsed = JSON.parse(readFileSync(JOBS_FILE, "utf-8"));
        return Array.isArray(parsed) ? (parsed as SelfJobConfig[]) : [];
    } catch {
        return [];
    }
}

function writeJobs(jobs: SelfJobConfig[]): void {
    mkdirSync(resolve(process.cwd(), ".agent"), { recursive: true });
    writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 4), "utf-8");
}

export const self_cron_jobs_tools = tool({
    description:
        "Manage scheduled self-cron jobs stored in .agent/self-jobs.json. " +
        "Actions: list (show all jobs), add (create a new job), remove (delete by name), run_now (trigger immediately without waiting for schedule). " +
        "Jobs are hot-registered — no restart needed. " +
        "Set run_once=true for one-shot reminders: the job fires exactly once then deletes itself. " +
        "Jobs fire on a cron schedule, the agent runs the message as a task, then optionally sends the result to Telegram chat IDs.",
    inputSchema: z.object({
        action: z.enum(["list", "add", "remove", "run_now"]).describe(
            "list = show all jobs | add = create new job | remove = delete job by name | run_now = trigger job immediately",
        ),
        // --- add ---
        name: z.string().optional().describe("Job name (unique, used as session key 'self-{name}'). Required for add, remove, run_now."),
        schedule: z.string().optional().describe("Cron expression e.g. '0 9 * * *' (daily 9am). Required for add."),
        message: z.string().optional().describe("Prompt the agent will run when the job fires. Required for add."),
        run_once: z.boolean().optional().describe(
            "If true, the job fires exactly once then removes itself. Use for one-shot reminders ('remind me in 3 hours'). Default: false (repeating).",
        ),
        telegram_chat_ids: z.array(z.number()).optional().describe(
            "Telegram chat IDs to notify with the result. Optional for add.",
        ),
    }),
    execute: async (input) => {
        const config = getConfig();

        if (input.action === "list") {
            const jobs = readJobs();
            if (jobs.length === 0) return { success: true, jobs: [], message: "No jobs configured." };
            return { success: true, jobs };
        }

        if (input.action === "add") {
            if (!input.name || !input.schedule || !input.message) {
                return { success: false, error: "add requires: name, schedule, message" };
            }
            // Validate cron expression
            const { default: cron } = await import("node-cron");
            if (!cron.validate(input.schedule)) {
                return { success: false, error: `Invalid cron expression: "${input.schedule}"` };
            }
            const jobs = readJobs();
            if (jobs.find((j) => j.name === input.name)) {
                return { success: false, error: `Job "${input.name}" already exists. Remove it first to replace.` };
            }
            const newJob: SelfJobConfig = {
                name: input.name,
                schedule: input.schedule,
                message: input.message,
                ...(input.run_once ? { run_once: true } : {}),
                ...(input.telegram_chat_ids?.length
                    ? { telegram: { chatIds: input.telegram_chat_ids } }
                    : {}),
            };
            jobs.push(newJob);
            writeJobs(jobs);
            logger.info(`Job added: ${input.name} → ${input.schedule}${newJob.run_once ? " (run_once)" : ""}`);

            // Hot-register into the live scheduler — no restart needed.
            const { registered } = registerJob(newJob);
            const activationNote = registered
                ? "Active immediately — will fire on its next scheduled tick."
                : "Saved to file. Will activate after the next agent restart (hot-registration unavailable in this channel).";

            return {
                success: true,
                message: `Job "${input.name}" added (${input.schedule}${newJob.run_once ? ", run_once" : ""}). ${activationNote}`,
                job: newJob,
            };
        }

        if (input.action === "remove") {
            if (!input.name) return { success: false, error: "remove requires: name" };
            const jobs = readJobs();
            const idx = jobs.findIndex((j) => j.name === input.name);
            if (idx === -1) return { success: false, error: `Job "${input.name}" not found.` };
            jobs.splice(idx, 1);
            writeJobs(jobs);
            // Stop the live cron task if it's currently scheduled.
            unregisterJob(input.name);
            logger.info(`Job removed: ${input.name}`);
            return { success: true, message: `Job "${input.name}" removed and unscheduled.` };
        }

        if (input.action === "run_now") {
            if (!input.name) return { success: false, error: "run_now requires: name" };
            const jobs = readJobs();
            // Also check config.self.jobs for jobs defined there
            const configJobs = config.self?.jobs ?? [];
            const job = jobs.find((j) => j.name === input.name) ?? configJobs.find((j) => j.name === input.name);
            if (!job) return { success: false, error: `Job "${input.name}" not found.` };

            logger.info(`run_now: triggering job "${job.name}"`);

            const { runAgent } = await import("@/agent/index.ts");
            const { loadHistory, saveHistory } = await import("@/channels/chat-store.ts");
            const { encode } = await import("gpt-tokenizer");
            const budget = config.self?.historyTokenBudget ?? 12000;

            const sessionKey = `self-${job.name}`;
            const rawHistory = loadHistory(sessionKey);

            // Trim + drop leading non-user messages
            let history = [...rawHistory];
            let total = history.reduce((sum, m) => {
                if (typeof m.content === "string") return sum + encode(m.content).length;
                return sum + encode(JSON.stringify(m.content)).length;
            }, 0);
            while (total > budget && history.length > 2) {
                total -= encode(JSON.stringify(history.shift())).length;
            }
            while (history.length > 0 && (history[0] as any).role !== "user") history.shift();

            const result = await runAgent(config, {
                userMessage: job.message,
                chatHistory: history,
                meta: { channel: "self", chatId: job.name },
            });

            const updated = [...history, { role: "user" as const, content: job.message }, ...result.responseMessages];
            let trimmed = [...updated];
            let trimTotal = trimmed.reduce((s, m) => s + encode(JSON.stringify(m.content)).length, 0);
            while (trimTotal > budget && trimmed.length > 2) {
                trimTotal -= encode(JSON.stringify(trimmed.shift())).length;
            }
            while (trimmed.length > 0 && (trimmed[0] as any).role !== "user") trimmed.shift();
            saveHistory(sessionKey, trimmed);

            // Send to Telegram if configured
            const chatIds = job.telegram?.chatIds ?? [];
            if (chatIds.length > 0) {
                const token = process.env.TELEGRAM_BOT_TOKEN;
                if (token) {
                    const { sendMessage } = await import("@/channels/telegram/api.ts");
                    for (const chatId of chatIds) {
                        await sendMessage(token, chatId, `🤖 <b>${job.name}</b>\n\n${result.text}`, "HTML");
                    }
                }
            }

            return {
                success: true,
                job: job.name,
                steps: result.steps,
                result: result.text,
            };
        }

        return { success: false, error: `Unknown action: ${(input as any).action}` };
    },
});
