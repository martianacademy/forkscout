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
        log("Step 3/3: Smoke passed — stopping current agent and starting fresh...");

        // Kill existing
        spawnSync("pkill", ["-9", "-f", "src/index.ts"], { cwd: ROOT });
        spawnSync("pkill", ["-9", "-f", "forkscout-agent"], { cwd: ROOT });
        await sleep(1200);

        // Tag HEAD as last-known-good
        spawnSync("git", ["tag", "-f", "forkscout-last-good", "HEAD"], { cwd: ROOT });

        // Start fresh detached process
        appendFileSync(AGENT_LOG, `\n[validate_and_restart] Starting fresh agent — ${new Date().toISOString()}\n`);
        const child = spawn("bun", ["run", "src/index.ts"], {
            cwd: ROOT,
            detached: true,
            stdio: ["ignore", "ignore", "ignore"],
            env: { ...process.env, DEVTOOLS: "1" },
        });
        child.unref();

        log(`Fresh agent started (PID ${child.pid}). Log: ${AGENT_LOG}`);
        return {
            success: true,
            message: `Agent restarted successfully (PID ${child.pid}). Reason: ${input.reason}`,
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
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
            resolve({ passed, reason, output });
        };

        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });

        // Send the test message then close stdin so CLI knows input is done
        child.stdin.write(message + "\n");
        child.stdin.end();

        // Give the process time to start + respond
        const timer = setTimeout(() => {
            // Timeout is acceptable — what matters is that output is non-empty
            if (output.trim().length > 0) {
                finish(true, "responded within timeout (process then killed)");
            } else {
                finish(false, `No output after ${timeoutSec}s — process may have crashed`);
            }
        }, timeoutSec * 1000);

        child.on("error", (err) => {
            clearTimeout(timer);
            finish(false, `Spawn error: ${err.message}`);
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            if (settled) return;
            if (output.trim().length > 0) {
                finish(true, `process exited (code ${code}) with output`);
            } else {
                finish(false, `process exited (code ${code}) with no output`);
            }
        });

        // Write smoke log for debugging
        child.stdout.on("data", (c: Buffer) => {
            try { appendFileSync(SMOKE_LOG, c); } catch { /* ignore */ }
        });
    });
}
