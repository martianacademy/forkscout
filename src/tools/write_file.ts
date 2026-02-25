import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export const IS_BOOTSTRAP_TOOL = true;

export const write_file = tool({
    description: "Write content to a file (creates or overwrites, creates parent directories if needed)",
    inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
        content: z.string().describe("Content to write"),
    }),
    execute: async (input) => {
        try {
            const abs = resolve(input.path);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, input.content, "utf-8");
            return { success: true };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
