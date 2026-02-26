// src/tools/read_folder_standards.ts
// Reads the ai_agent_must_readme.md for a src/ subfolder.
// Call this before modifying ANY file in that folder.
import { tool } from "ai";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const IS_BOOTSTRAP_TOOL = true;

export const read_folder_standard_tools = tool({
    description:
        "Read the coding standards and contracts for a src/ subfolder before modifying it. " +
        "ALWAYS call this before editing or creating files in any src/ subfolder. " +
        "Returns the folder's ai_agent_must_readme.md which documents: purpose, file format, rules, and current contents.",
    inputSchema: z.object({
        folder: z
            .string()
            .describe(
                "Folder name under src/ — e.g. 'tools', 'channels', 'providers', 'agent', 'llm', 'utils', 'logs', 'mcp-servers'"
            ),
    }),
    execute: async (input) => {
        const readmePath = resolve(srcDir, input.folder, "ai_agent_must_readme.md");
        try {
            const content = readFileSync(readmePath, "utf-8");
            return { success: true, folder: input.folder, content };
        } catch {
            // Check if the folder itself exists
            try {
                readFileSync(resolve(srcDir, input.folder), "utf-8");
            } catch (e: any) {
                if (e.code === "ENOENT") {
                    return {
                        success: false,
                        error: `Folder src/${input.folder}/ does not exist. Create it and write ai_agent_must_readme.md before adding any code.`,
                    };
                }
            }
            return {
                success: false,
                error: `No ai_agent_must_readme.md found in src/${input.folder}/. Create it before editing this folder.`,
            };
        }
    },
});
