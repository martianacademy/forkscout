import { tool } from "ai";
import { z } from "zod";
import { readdirSync, statSync } from "fs";
import { resolve } from "path";
import { isSensitiveDir, isSensitivePath, SENSITIVE_PATH_BLOCKED_MSG } from "@/utils/sensitive-paths.ts";

export const IS_BOOTSTRAP_TOOL = true;

export const list_dir_tools = tool({
    description: "List files and directories in a folder",
    inputSchema: z.object({
        path: z.string().describe("Path to the directory"),
    }),
    execute: async (input) => {
        // Block listing sensitive directories entirely
        if (isSensitiveDir(input.path)) {
            return { success: false, error: SENSITIVE_PATH_BLOCKED_MSG };
        }

        try {
            const entries = readdirSync(resolve(input.path))
                .filter((name) => {
                    // Hide sensitive files/dirs from listings
                    const full = resolve(input.path, name);
                    return !isSensitivePath(full);
                })
                .map((name) => {
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
