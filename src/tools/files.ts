// src/tools/files.ts — File read/write/list
import { tool } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve } from "path";

export const readFileTool = tool({
    description: "Read the contents of a file",
    inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
    }),
    execute: async (input) => {
        try {
            const content = readFileSync(resolve(input.path), "utf-8");
            return { success: true, content };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});

export const writeFileTool = tool({
    description: "Write content to a file (creates or overwrites)",
    inputSchema: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
        content: z.string().describe("Content to write"),
    }),
    execute: async (input) => {
        try {
            writeFileSync(resolve(input.path), input.content, "utf-8");
            return { success: true };
        } catch (err: any) {
            return { success: false, error: (err as Error).message };
        }
    },
});

export const listDirTool = tool({
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
