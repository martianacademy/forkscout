import { tool } from "ai";
import { z } from "zod";
import { readdirSync, statSync } from "fs";
import { resolve } from "path";

export const IS_BOOTSTRAP_TOOL = true;

export const list_dir = tool({
    description: "List files and directories in a folder",
    inputSchema: z.object({
        path: z.string().describe("Path to the directory"),
    }),
    execute: async (input) => {
        try {
            const entries = readdirSync(resolve(input.path)).map((name) => {
                const full = resolve(input.path, name);
                const isDir = statSync(full).isDirectory();
                return isDir ? `${name}/` : name;
            });
            return { success: true, entries };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});
