// src/tools/shell.ts — Run shell commands
import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";

export const shellTool = tool({
    description: "Run a shell command and return its output. Use for system tasks, file operations, git, etc.",
    inputSchema: z.object({
        command: z.string().describe("The shell command to run"),
        cwd: z.string().optional().describe("Working directory (default: process.cwd())"),
        timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    }),
    execute: async (input) => {
        const { command, cwd, timeout = 30000 } = input;
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
