import { tool } from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve } from "path";

export const IS_BOOTSTRAP_TOOL = true;

/** Files at or below this line count are returned in full. Above → agent must use shell or specify a range. */
const MAX_FULL_READ_LINES = 200;

export const read_file_tools = tool({
    description:
        "Read the contents of a file. " +
        "Files ≤200 lines: returns the full content in one call. " +
        "Files >200 lines: returns only the line count — use run_shell_command('cat <path>') to read full, " +
        "or pass startLine/endLine to read a specific range.",
    inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
        startLine: z.number().int().min(1).optional().describe("First line to read (1-based, inclusive). Omit to auto-read."),
        endLine: z.number().int().min(1).optional().describe("Last line to read (1-based, inclusive). Omit to auto-read."),
    }),
    execute: async (input) => {
        try {
            const allLines = readFileSync(resolve(input.path), "utf-8").split("\n");
            const totalLines = allLines.length;

            // If caller specified an explicit range, honour it regardless of file size
            if (input.startLine != null || input.endLine != null) {
                const start = Math.max(1, input.startLine ?? 1);
                const end = Math.min(totalLines, input.endLine ?? totalLines);
                const chunk = allLines.slice(start - 1, end).join("\n");
                return {
                    success: true,
                    content: chunk,
                    startLine: start,
                    endLine: end,
                    totalLines,
                    hasMore: end < totalLines,
                };
            }

            // Small file → return everything in one shot
            if (totalLines <= MAX_FULL_READ_LINES) {
                return {
                    success: true,
                    content: allLines.join("\n"),
                    startLine: 1,
                    endLine: totalLines,
                    totalLines,
                    hasMore: false,
                };
            }

            // Large file → don't return content, tell agent to use shell or specify range
            return {
                success: true,
                content: null,
                totalLines,
                message: `File has ${totalLines} lines (>${MAX_FULL_READ_LINES}). Use run_shell_command('cat ${input.path}') to read full content, or call read_file with startLine/endLine for a specific range.`,
            };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
