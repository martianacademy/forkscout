import { tool } from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve } from "path";

export const IS_BOOTSTRAP_TOOL = true;

export const read_file_tools = tool({
    description:
        "Read the contents of a file. " +
        "Always use startLine/endLine to read in chunks — never read large files all at once. " +
        "First call: omit startLine/endLine to read lines 1-200 and see total line count. " +
        "Then read further chunks as needed using startLine/endLine. " +
        "For files >200 lines, always paginate rather than reading the whole file.",
    inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
        startLine: z.number().int().min(1).optional().describe("First line to read (1-based, inclusive). Omit to start from line 1."),
        endLine: z.number().int().min(1).optional().describe("Last line to read (1-based, inclusive). Omit to read up to line 200 on the first call."),
    }),
    execute: async (input) => {
        try {
            const allLines = readFileSync(resolve(input.path), "utf-8").split("\n");
            const totalLines = allLines.length;

            const start = Math.max(1, input.startLine ?? 1);
            const end = Math.min(totalLines, input.endLine ?? Math.min(200, totalLines));

            const chunk = allLines.slice(start - 1, end).join("\n");

            return {
                success: true,
                content: chunk,
                startLine: start,
                endLine: end,
                totalLines,
                hasMore: end < totalLines,
            };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
