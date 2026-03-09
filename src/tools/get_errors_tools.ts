// src/tools/get_errors_tools.ts — Run TypeScript typecheck and return structured errors
import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";


interface TsError {
    file: string;
    line: number;
    col: number;
    code: string;
    message: string;
}

function parseTscOutput(raw: string): TsError[] {
    const errors: TsError[] = [];
    // format: src/foo.ts(10,5): error TS2304: Cannot find name 'x'.
    const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        errors.push({
            file: m[1],
            line: parseInt(m[2], 10),
            col: parseInt(m[3], 10),
            code: m[4],
            message: m[5].trim(),
        });
    }
    return errors;
}

export const get_errors = tool({
    description:
        "Run TypeScript typecheck (bun run typecheck → tsc --noEmit) and return structured errors with file, line, column, error code, and message. " +
        "WHEN TO USE: after any code change to verify nothing is broken; before committing or restarting; " +
        "when you suspect a type error but aren't sure which file. " +
        "WHEN NOT TO USE: runtime errors (not type errors) — use run_shell_command_tools to run the actual code. " +
        "Returns: error_count, list of {file, line, col, code, message} objects. If clean, returns { error_count: 0, message: 'No type errors'. }. " +
        "Example: {} — run with defaults to check the whole project.",
    inputSchema: z.object({
        cwd: z.string().optional().describe(
            "Project root to run typecheck from (default: process.cwd())"
        ),
        max_errors: z.number().int().min(1).max(100).default(30).describe(
            "Max number of errors to return (default: 30)"
        ),
    }),
    execute: async (input) => {
        const { cwd = process.cwd(), max_errors } = input;

        try {
            execSync("bun run typecheck", {
                cwd,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 60000,
            });
            return { success: true, error_count: 0, errors: [], message: "No type errors found." };
        } catch (err: any) {
            const stderr = (err.stderr as string | undefined) ?? "";
            const stdout = (err.stdout as string | undefined) ?? "";
            const combined = stderr + "\n" + stdout;
            const errors = parseTscOutput(combined).slice(0, max_errors);

            if (errors.length === 0) {
                // tsc failed but unparseable output — return raw
                return {
                    success: false,
                    error_count: 0,
                    errors: [],
                    raw: combined.trim().slice(0, 2000),
                };
            }

            return {
                success: true,
                error_count: errors.length,
                errors,
                truncated: errors.length === max_errors,
            };
        }
    },
});
