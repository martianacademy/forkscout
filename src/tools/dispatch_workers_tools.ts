// src/tools/dispatch_workers_tools.ts
// Three tools for autonomous self-session orchestration:
//
//   chain_of_workers    — sequential chain where output feeds the next input (or tasks must run in order)
//   parallel_workers    — independent tasks dispatched concurrently with live Telegram progress card
//   list_active_workers — inspect all running/pending task batches
//
// Self-channel history layout:
//   chain sessions   → .forkscout/chats/self/               (full history, shared across chain)
//   parallel workers → .forkscout/chats/self-{key}/         (isolated, no prior history passed)
//   aggregator       → .forkscout/chats/self-agg-{batch}/   (isolated)

import { tool } from "ai";
import { z } from "zod";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } from "fs";
import { resolve } from "path";
import { getConfig } from "@/config.ts";
import { sendMessage } from "@/channels/telegram/api.ts";
import { mdToHtml } from "@/channels/telegram/format.ts";
import { startProgressMonitor, listActiveMonitors, TASKS_DIR, loadOrphanedMonitors, resumeMonitor, cancelMonitor } from "@/channels/self/progress-monitor.ts";
import { log } from "@/logs/logger.ts";

export const IS_BOOTSTRAP_TOOL = false;

const logger = log("tool:dispatch_workers");

// ════════════════════════════════════════════════════════════════════════════════
// chain_of_workers — sequential, output of one feeds the next
// ════════════════════════════════════════════════════════════════════════════════

export const chain_of_workers = tool({
    description:
        "Trigger the next step in a sequential self-session chain. " +
        "Use when each step's output is the next step's input, or when tasks must run in a specific order. " +
        "Fires and forgets by default — current session ends cleanly, next session picks up from full shared history. " +
        "Pattern: write a todo/progress file → call chain_of_workers → current session ends → " +
        "next session reads the file, does one unit of work, saves progress, calls chain_of_workers again → repeat until done. " +
        "For independent tasks with no dependencies between them, use parallel_workers instead.",
    inputSchema: z.object({
        prompt: z.string().describe(
            "Instruction for the next session. Be specific — include file paths and task context. " +
            "The next session has full history of all prior self-sessions so it knows what was done before."
        ),
        role: z.enum(["owner", "admin", "user", "self"]).optional().describe(
            "Trust role for the new session. Defaults to 'self' (no restrictions, agent-to-agent)."
        ),
        wait: z.boolean().optional().describe(
            "If true, blocks and waits for the session to finish before returning. " +
            "Avoid in chains — nests sessions and breaks history. Default: false (fire and forget)."
        ),
        chat_id: z.number().optional().describe(
            "Telegram chat ID to notify when this step starts. " +
            "Sends: 🔄 Step started: \"<first 80 chars of prompt>\""
        ),
    }),
    execute: async (input) => {
        const config = getConfig();
        const port = config.self?.httpPort ?? 3200;

        if (port === 0) return { success: false, error: "Self HTTP server disabled (httpPort = 0)" };

        const url = `http://localhost:${port}/trigger`;
        const body = { prompt: input.prompt, role: input.role ?? "self" };

        logger.info(`chain_of_workers: ${input.prompt.slice(0, 80)}`);

        // ── Optional Telegram step notification ───────────────────────────────
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (input.chat_id && token) {
            const preview = input.prompt.slice(0, 80) + (input.prompt.length > 80 ? "..." : "");
            await sendMessage(token, input.chat_id, mdToHtml(`🔄 **Step started:** "${preview}"`), "HTML");
        }

        if (!input.wait) {
            fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }).catch((err) => logger.error("chain_of_workers fire-and-forget error:", err.message));

            return {
                success: true,
                queued: true,
                note: "Next session triggered in background. History at: .forkscout/chats/self/",
            };
        }

        // wait=true — block until done (avoid in chains)
        let res: Response;
        try {
            res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        } catch (err: any) {
            return { success: false, error: `Could not reach self HTTP server on port ${port}: ${err.message}` };
        }

        let data: unknown;
        try { data = await res.json(); }
        catch { return { success: false, error: `Non-JSON response (status ${res.status})` }; }

        const d = data as Record<string, unknown>;
        if (!d.ok) return { success: false, error: d.error ?? `Session failed (status ${res.status})` };

        return { success: true, steps: d.steps, result: d.text };
    },
});

// ════════════════════════════════════════════════════════════════════════════════
// parallel_workers — independent concurrent tasks with live Telegram progress card
// ════════════════════════════════════════════════════════════════════════════════

export const parallel_workers = tool({
    description:
        "Dispatch N parallel worker self-sessions for independent tasks, with a live Telegram progress card. " +
        "Use when tasks have no dependencies on each other and can run concurrently. " +
        "Creates a plan.md tracking all tasks ([ ] pending → [x] done). " +
        "A pure-JS monitor (zero LLM cost while waiting) updates a single Telegram message every few seconds. " +
        "When all tasks are [x], an aggregator self-session fires once automatically to compile results and notify the user. " +
        "For sequential tasks where each output feeds the next, use chain_of_workers instead.",
    inputSchema: z.object({
        batch_name: z.string().describe(
            "Unique name for this batch (e.g. 'analyze-codebase', 'research-2026'). " +
            "Folder: .forkscout/tasks/{batch_name}/"
        ),
        tasks: z.array(z.object({
            session_key: z.string().describe(
                "Unique key for this worker (e.g. 'task-auth', 'task-db'). " +
                "Audit history at: .forkscout/chats/self-{session_key}/"
            ),
            label: z.string().describe(
                "Short label shown in the Telegram progress card (e.g. 'Analyse auth module')."
            ),
            prompt: z.string().describe(
                "Full self-contained prompt for this worker. Must include: " +
                "1) The actual task. " +
                "2) Where to write results: .forkscout/tasks/{batch_name}/{session_key}-result.md. " +
                "3) When finished, mark done by flipping '- [ ] `{session_key}`' to '- [x] `{session_key}`' " +
                "in .forkscout/tasks/{batch_name}/plan.md."
            ),
        })).min(1).describe("List of independent parallel tasks to run."),
        aggregator_prompt: z.string().describe(
            "Prompt for the aggregator self-session fired when ALL tasks are [x]. " +
            "Should: read all result files from .forkscout/tasks/{batch_name}/, " +
            "compile a final summary, send it via telegram_message_tools to notify the user, " +
            "then delete .forkscout/tasks/{batch_name}/ to clean up."
        ),
        chat_id: z.number().optional().describe(
            "Telegram chat ID for live progress updates. If omitted, workers still run silently."
        ),
        interval_seconds: z.number().optional().describe(
            "How often the progress card refreshes. Default: 3 seconds."
        ),
        timeout_minutes: z.number().optional().describe(
            "Stop monitoring and send a timeout alert after this many minutes. Default: 30."
        ),
    }),
    execute: async (input) => {
        const config = getConfig();
        const port = config.self?.httpPort ?? 3200;
        const token = process.env.TELEGRAM_BOT_TOKEN;

        if (port === 0) return { success: false, error: "Self HTTP server disabled (httpPort = 0)" };

        // ── 1. Create plan.md ─────────────────────────────────────────────────
        const batchDir = resolve(TASKS_DIR, input.batch_name);
        mkdirSync(batchDir, { recursive: true });

        const planContent =
            `## Batch: ${input.batch_name}\n\n` +
            input.tasks.map((t) => `- [ ] \`${t.session_key}\` — ${t.label}`).join("\n") +
            "\n";
        const planFile = resolve(batchDir, "plan.md");
        writeFileSync(planFile, planContent, "utf-8");

        logger.info(`parallel_workers "${input.batch_name}": plan.md created (${input.tasks.length} tasks)`);

        // ── 2. Send initial Telegram message ──────────────────────────────────
        let initialMessageId = 0;
        if (input.chat_id && token) {
            const msgId = await sendMessage(token, input.chat_id, planContent);
            if (msgId !== null) initialMessageId = msgId;
        }

        // ── 3. Dispatch all workers in parallel (all fire-and-forget) ─────────
        const url = `http://localhost:${port}/trigger`;
        for (const task of input.tasks) {
            fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: task.prompt, role: "self", session_key: task.session_key }),
            }).catch((err) => logger.error(`Worker "${task.session_key}" dispatch error:`, err.message));
        }

        logger.info(`parallel_workers "${input.batch_name}": ${input.tasks.length} worker(s) dispatched`);

        // ── 4. Start pure-JS progress monitor (no LLM cost while waiting) ─────
        const monitoring = !!(input.chat_id && token && initialMessageId);
        if (monitoring) {
            startProgressMonitor({
                batchName: input.batch_name,
                planFile,
                chatId: input.chat_id!,
                initialMessageId,
                token: token!,
                aggregatorPrompt: input.aggregator_prompt,
                httpPort: port,
                intervalSeconds: input.interval_seconds,
                timeoutMinutes: input.timeout_minutes,
            });
        }

        return {
            success: true,
            batch_name: input.batch_name,
            dispatched: input.tasks.length,
            plan_file: planFile,
            monitoring,
            note: monitoring
                ? `${input.tasks.length} workers running. Telegram progress card active. Aggregator fires automatically when all done.`
                : `${input.tasks.length} workers running. No chat_id provided — no Telegram updates.`,
        };
    },
});

// ════════════════════════════════════════════════════════════════════════════════
// manage_workers — resume or cancel a monitor after Bun restart
// ════════════════════════════════════════════════════════════════════════════════

export const manage_workers = tool({
    description:
        "Resume, cancel, or delete a task batch after the agent restarted. " +
        "Use after receiving a restart notification that lists orphaned batches. " +
        "resume: restarts the progress monitor from saved state, sends a fresh Telegram progress card — workers continue. " +
        "cancel: stops the monitor, deletes saved state — task files in .forkscout/tasks/{batch}/ are kept. " +
        "delete: full cleanup — stops monitor, deletes saved state AND the .forkscout/tasks/{batch}/ directory entirely.",
    inputSchema: z.object({
        action: z.enum(["resume", "cancel", "delete"]).describe(
            "resume = restart the monitor | cancel = stop + delete state, keep task files | delete = stop + delete state + delete all task files"
        ),
        batch_name: z.string().describe(
            "The batch name to act on (e.g. 'analyze-codebase')."
        ),
    }),
    execute: async (input) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return { success: false, error: "TELEGRAM_BOT_TOKEN is not set" };

        const orphans = loadOrphanedMonitors();
        const state = orphans.find((s) => s.batchName === input.batch_name);

        if (input.action === "cancel") {
            cancelMonitor(input.batch_name);
            return {
                success: true,
                note: `Batch "${input.batch_name}" cancelled. Monitor state deleted. Task files in .forkscout/tasks/${input.batch_name}/ are kept.`,
            };
        }

        if (input.action === "delete") {
            cancelMonitor(input.batch_name);
            const batchDir = resolve(TASKS_DIR, input.batch_name);
            if (existsSync(batchDir)) {
                rmSync(batchDir, { recursive: true, force: true });
            }
            return {
                success: true,
                note: `Batch "${input.batch_name}" fully deleted. Monitor state and task files removed.`,
            };
        }

        // resume
        if (!state) {
            return {
                success: false,
                error: `No saved state found for batch "${input.batch_name}". It may have already completed, been cancelled, or never ran.`,
            };
        }

        if (!existsSync(state.planFile)) {
            return {
                success: false,
                error: `plan.md not found at ${state.planFile}. Batch may have been cleaned up already.`,
            };
        }

        await resumeMonitor(state, token);

        return {
            success: true,
            batch_name: input.batch_name,
            note: `Monitor resumed for batch "${input.batch_name}". Progress card sent to Telegram. Aggregator will fire when all tasks are done.`,
        };
    },
});

export const list_active_workers = tool({
    description:
        "List all active task batches in .forkscout/tasks/. " +
        "Shows per-worker status (pending [ ] / done [x]), progress fraction (e.g. 3/5), " +
        "and which batches have a live progress monitor running. " +
        "Use this to check on running parallel work, debug a stuck batch, or confirm all tasks are done.",
    inputSchema: z.object({}),
    execute: async (_input) => {
        if (!existsSync(TASKS_DIR)) {
            return { success: true, batches: [], note: "No task batches found — .forkscout/tasks/ does not exist yet." };
        }

        let batchNames: string[];
        try {
            batchNames = readdirSync(TASKS_DIR, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name);
        } catch (err: any) {
            return { success: false, error: `Failed to read tasks directory: ${err.message}` };
        }

        if (batchNames.length === 0) {
            return { success: true, batches: [], note: "No task batches found." };
        }

        const activeMonitorNames = new Set(listActiveMonitors());

        const batches = batchNames.map((batchName) => {
            const planFile = resolve(TASKS_DIR, batchName, "plan.md");

            if (!existsSync(planFile)) {
                return { batch_name: batchName, has_monitor: activeMonitorNames.has(batchName), error: "plan.md not found", workers: [] };
            }

            let content: string;
            try {
                content = readFileSync(planFile, "utf-8");
            } catch (err: any) {
                return { batch_name: batchName, has_monitor: activeMonitorNames.has(batchName), error: err.message, workers: [] };
            }

            const matches = [...content.matchAll(/^- \[(.)\] `([^`]+)` — (.+)$/gm)];
            const workers = matches.map((m) => ({
                session_key: m[2],
                label: m[3],
                done: m[1] === "x",
            }));

            const done = workers.filter((w) => w.done).length;

            return {
                batch_name: batchName,
                has_monitor: activeMonitorNames.has(batchName),
                progress: `${done}/${workers.length}`,
                all_done: workers.length > 0 && done === workers.length,
                workers,
            };
        });

        const running = batches.filter((b) => "all_done" in b && !b.all_done).length;

        return {
            success: true,
            batches,
            summary: `${batches.length} batch(es), ${running} still running.`,
        };
    },
});
