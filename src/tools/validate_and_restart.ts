// src/tools/validate_and_restart.ts
// Safe self-restart tool for the agent.
//
// Flow (current agent stays alive throughout until the test passes):
//   1. Run `bun run typecheck` — abort immediately if TS errors found
//   2. Spawn a SEPARATE CLI process with a smoke message — current agent keeps running
//   3. Smoke test must produce non-empty output within timeout
//   4. ONLY if smoke passes: kill existing instances → start fresh production process
//   5. If smoke fails: return error report — nothing was killed, agent keeps running

import { tool } from "ai";
import { z } from "zod";
import { spawnSync, spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, appendFileSync } from "fs";

export const IS_BOOTSTRAP_TOOL = false;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENT_LOG = "/tmp/forkscout.log";
const SMOKE_LOG = "/tmp/forkscout-validate-smoke.log";

export const validate_and_restart = tool({
    description:
        "Safely restart the agent after code changes. " +
        "Runs typecheck then boots a SEPARATE test process (current agent stays alive). " +
        "Only if the test passes does it kill the current agent and start fresh. " +
        "If anything fails the current agent keeps running — use this instead of bun run safe-restart or bun start.",
    inputSchema: z.object({
        reason: z.string().describe("Why a restart is needed (shown in logs)"),
        smoke_message: z
            .string()
            .optional()
            .describe(
                "Custom test message to send to the new process. Default: 'reply with only the single word: ok'"
            ),
        timeout_seconds: z
            .number()
            .optional()
            .describe("Seconds to wait for smoke test response. Default: 90"),
    }),
    execute: async (input) => {
        const smokeMsg = input.smoke_message ?? "reply with only the single word: ok";
        const timeoutSec = input.timeout_seconds ?? 90;

        log(`Validate-and-restart triggered: ${input.reason}`);

        // ── Step 1: Typecheck ──────────────────────────────────────────────────
        log("Step 1/3: Running typecheck...");
        const tc = spawnSync("bun", ["run", "--bun", "tsc", "--noEmit"], {
            cwd: ROOT,
            encoding: "utf-8",
            timeout: 60_000,
        });

        if (tc.status !== 0) {
            const errors = (tc.stdout + tc.stderr).trim().slice(0, 2000);
            log(`Typecheck FAILED:\n${errors}`);
            return {
                success: false,
                stage: "typecheck",
                error: "TypeScript errors found — restart aborted. Agent still running.",
                details: errors,
            };
        }
        log("Typecheck passed ✓");

        // ── Step 2: Smoke test in separate process (agent stays alive) ─────────
        log(`Step 2/3: Smoke testing new code (timeout ${timeoutSec}s)...`);
        const smokeResult = await runSmokeTest(smokeMsg, timeoutSec);

        if (!smokeResult.passed) {
            log(`Smoke test FAILED: ${smokeResult.reason}`);
            return {
                success: false,
                stage: "smoke_test",
                error: "New process failed to respond — restart aborted. Agent still running.",
                details: smokeResult.reason,
                smoke_output: smokeResult.output,
            };
        }
        log(`Smoke test passed ✓ (response: "${smokeResult.output.slice(0, 80)}")`);

        // ── Step 3: Kill current + start fresh ────────────────────────────────
        log("Step 3/3: Smoke passed — scheduling deferred restart...");

        // CRITICAL: this tool runs INSIDE the agent process.
        // Calling `pkill -f src/index.ts` here kills ourselves mid-execution,
        // before spawn() completes — new agent never starts.
        // Fix: write a detached shell script that waits 2s (lets this response
        // flush to Telegram), then kills the old process and starts fresh.
        spawnSync("git", ["tag", "-f", "forkscout-last-good", "HEAD"], { cwd: ROOT });

        const restartScript = [
            "#!/bin/sh",
            "sleep 2",
            "pkill -9 -f 'src/index.ts' 2>/dev/null || true",
            "pkill -9 -f 'forkscout-agent' 2>/dev/null || true",
            "lsof -ti :3200 | xargs kill -9 2>/dev/null || true",
            "sleep 2",
            `echo "[validate_and_restart] Starting fresh agent -- $(date -u)" >> ${AGENT_LOG}`,
            `cd ${ROOT} && DEVTOOLS=1 nohup bun run src/index.ts >> ${AGENT_LOG} 2>&1 &`,
            `echo "[validate_and_restart] Fresh agent spawned (PID $!)" >> ${AGENT_LOG}`,
        ].join("\n");

        const scriptPath = "/tmp/forkscout-restart.sh";
        const { writeFileSync: wfs, chmodSync } = await import("fs");
        wfs(scriptPath, restartScript, "utf-8");
        chmodSync(scriptPath, 0o755);

        const restarter = spawn("sh", [scriptPath], {
            detached: true,
            stdio: "ignore",
        });
        restarter.unref();

        log(`Restart script spawned (PID ${restarter.pid}). Agent will reload in ~4s. Log: ${AGENT_LOG}`);
        return {
            success: true,
            message: `Restart scheduled (PID ${restarter.pid}). Old instance will be replaced in ~4 seconds. Reason: ${input.reason}`,
            smoke_response: smokeResult.output.trim(),
        };
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
    const line = `[validate_and_restart] ${msg}`;
    console.log(line);
    try { appendFileSync(AGENT_LOG, line + "\n"); } catch { /* ignore */ }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SmokeResult {
    passed: boolean;
    reason: string;
    output: string;
}

function runSmokeTest(message: string, timeoutSec: number): Promise<SmokeResult> {
    return new Promise((resolve) => {
        let output = "";
        let settled = false;

        const child = spawn(
            "bun",
            ["run", "src/index.ts", "--cli"],
            {
                cwd: ROOT,
                stdio: ["pipe", "pipe", "pipe"],
                env: {
                    ...process.env,
                    // Suppress devtools + noisy output in smoke mode
                    DEVTOOLS: "0",
                    FORKSCOUT_SMOKE: "1",
                },
            }
        );

        const finish = (passed: boolean, reason: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(hardTimer);
            clearTimeout(earlyTimer);
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
            resolve({ passed, reason, output });
        };

        // Early-finish: once output arrives, wait 3s for more data then resolve.
        // Prevents waiting the full timeout when LLM already responded.
        let earlyTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleEarlyFinish = () => {
            if (earlyTimer || settled) return;
            earlyTimer = setTimeout(() => {
                if (output.trim().length > 0) {
                    finish(true, "responded — early finish after output settled");
                }
            }, 3_000);
        };

        child.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            try { appendFileSync(SMOKE_LOG, chunk); } catch { /* ignore */ }
            scheduleEarlyFinish();
        });
        child.stderr.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            scheduleEarlyFinish();
        });

        // Send the test message then close stdin so CLI knows input is done
        child.stdin.write(message + "\n");
        child.stdin.end();

        // Hard timeout — last resort if process never responds or closes
        const hardTimer = setTimeout(() => {
            if (output.trim().length > 0) {
                finish(true, `responded within ${timeoutSec}s timeout`);
            } else {
                finish(false, `No output after ${timeoutSec}s — process may have crashed`);
            }
        }, timeoutSec * 1000);

        child.on("error", (err) => {
            finish(false, `Spawn error: ${err.message}`);
        });

        child.on("close", (code) => {
            if (settled) return;
            if (output.trim().length > 0) {
                finish(true, `process exited (code ${code}) with output`);
            } else {
                finish(false, `process exited (code ${code}) with no output`);
            }
        });
    });
}
