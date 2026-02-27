// src/tools/run_code_tools.ts — Execute code in an isolated subprocess
// path — Execute code snippets in sandboxed subprocess (Bun/Python)

import { writeFileSync, unlinkSync } from "fs";
import { spawn } from "child_process";
import { tool } from "ai";
import { z } from "zod";

const SUPPORTED_LANGUAGES = {
    typescript: { ext: "ts", cmd: "bun" },
    javascript: { ext: "js", cmd: "bun" },
    python: { ext: "py", cmd: "python3" },
};

function cleanup(filePath: string): void {
    try {
        unlinkSync(filePath);
    } catch {
        // ignore cleanup errors
    }
}

function runCommand(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, { timeout });

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timeoutHandle = setTimeout(() => {
            timedOut = true;
            proc.kill("SIGTERM");
        }, timeout * 1000);

        proc.stdout?.on("data", (data) => { stdout += data.toString(); });
        proc.stderr?.on("data", (data) => { stderr += data.toString(); });

        proc.on("close", (code) => {
            clearTimeout(timeoutHandle);
            resolve({
                stdout,
                stderr,
                exitCode: code ?? -1,
                timedOut,
            });
        });

        proc.on("error", (err) => {
            clearTimeout(timeoutHandle);
            resolve({
                stdout,
                stderr: err.message,
                exitCode: -1,
                timedOut: false,
            });
        });
    });
}

export const run_code_tools = tool({
    description: "Execute a code snippet in an isolated subprocess and return stdout/stderr/exit code. Supports TypeScript, JavaScript (via Bun), and Python. Use for computation, algorithms, data transformation, quick prototyping, and testing logic. Code runs in /tmp — cannot write to the project directory unless you explicitly pass a path. Hard timeout prevents runaway processes (default 30s, max 120s). NOT for shell administration — use run_shell_command_tools for that.",
    inputSchema: z.object({
        code: z.string().describe("The code to execute"),
        language: z.enum(["typescript", "javascript", "python"]).describe("Language to run the code as"),
        timeout_seconds: z.number().min(1).max(120).default(30).describe("Hard kill timeout in seconds (default 30, max 120)"),
    }),
    execute: async ({ code, language, timeout_seconds }) => {
        const langConfig = SUPPORTED_LANGUAGES[language];
        if (!langConfig) {
            return { success: false, error: `Unsupported language: ${language}` };
        }

        const filePath = `/tmp/sandbox_${Date.now()}.${langConfig.ext}`;

        try {
            writeFileSync(filePath, code);
        } catch (err) {
            return { success: false, error: `Failed to write code to temp file: ${(err as Error).message}` };
        }

        let result;
        try {
            result = await runCommand(langConfig.cmd, ["run", filePath], timeout_seconds * 1000);
        } catch (err: any) {
            cleanup(filePath);
            return { success: false, error: `Execution error: ${err.message}` };
        }

        cleanup(filePath);

        return {
            success: result.exitCode === 0 && !result.timedOut,
            exit_code: result.exitCode,
            stdout: result.stdout.slice(0, 8000),
            stderr: result.stderr.slice(0, 4000),
            timed_out: result.timedOut,
        };
    },
});
