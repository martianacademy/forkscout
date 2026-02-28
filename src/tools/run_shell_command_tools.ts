// src/tools/run_shell_command_tools.ts — Run shell commands with self-kill protection
import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";

export const IS_BOOTSTRAP_TOOL = true;

/**
 * Patterns that would kill the agent's own process.
 * These are blocked to prevent the agent from committing suicide.
 * Restart must go through validate_and_restart tool instead.
 */
const SUICIDE_PATTERNS = [
    /pkill.*bun/i,
    /pkill.*forkscout/i,
    /pkill.*index\.ts/i,
    /kill\s+(-9\s+)?(\$\$|%|`pgrep)/i,
    /killall.*bun/i,
    /bun\s+run\s+(start|dev|restart|safe-restart)/i,
    /bun\s+start/i,
    /bun\s+run\s+src\/index/i,
    /kill\s+-9?\s*\d{3,}/,  // kill <pid> — block explicit PID kills too
];

function isSuicideCommand(cmd: string): boolean {
    return SUICIDE_PATTERNS.some((pattern) => pattern.test(cmd));
}

export const run_shell_command_tools = tool({
    description: "Run a shell command and return its output. Use for system tasks, file operations, git, etc. CANNOT be used to restart or kill the agent — use validate_and_restart tool for that.",
    inputSchema: z.object({
        command: z.string().describe("The shell command to run"),
        cwd: z.string().optional().describe("Working directory (default: process.cwd())"),
        timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    }),
    execute: async (input) => {
        const { command, cwd, timeout = 30000 } = input;

        // Block commands that would kill the agent's own process
        if (isSuicideCommand(command)) {
            return {
                success: false,
                output: "",
                error: "BLOCKED: This command would kill the agent process. Use the validate_and_restart tool to safely restart — it typechecks first, tests the new code, and only then restarts.",
            };
        }

        try {
            const output = execSync(command, {
                cwd: cwd ?? process.cwd(),
                timeout,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
            });
            return { success: true, output: output.trim() };
        } catch (err: any) {
            return {
                success: false,
                output: (err.stdout as string | undefined)?.trim() ?? "",
                error: (err.stderr as string | undefined)?.trim() ?? (err as Error).message,
            };
        }
    },
});
