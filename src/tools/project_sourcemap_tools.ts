// src/tools/project_sourcemap_tools.ts — Returns a structured map of the src/ directory with per-file and per-folder descriptions.
import { tool } from "ai";
import { z } from "zod";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

export const IS_BOOTSTRAP_TOOL = false;

const PROJECT_ROOT = process.cwd();
const SRC_DIR = join(PROJECT_ROOT, "src");

/** Extract description from a .ts file — tries line 1 "// path — desc", then line 2 */
function getFileDescription(filePath: string): string {
    try {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n").slice(0, 3);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("//")) continue;
            const text = trimmed.replace(/^\/\/\s*/, "");
            const dashIdx = text.indexOf(" — ");
            if (dashIdx !== -1) return text.slice(dashIdx + 3).trim();
            // line has path but no desc — try next line
        }
        return "";
    } catch {
        return "";
    }
}

/** Extract description from ai_agent_must_readme.md — first meaningful non-heading line */
function getFolderDescription(folderPath: string): string {
    const readmePath = join(folderPath, "ai_agent_must_readme.md");
    if (!existsSync(readmePath)) return "";
    try {
        const lines = readFileSync(readmePath, "utf-8").split("\n");
        // First try: find a line with " — " (typically "# FolderName — description")
        for (const line of lines.slice(0, 5)) {
            const trimmed = line.trim();
            const dashIdx = trimmed.indexOf(" — ");
            if (dashIdx !== -1) {
                const desc = trimmed.slice(dashIdx + 3).trim();
                // Skip generic headings
                if (desc && !desc.toLowerCase().includes("how this folder works")) return desc;
            }
        }
        // Fallback: first non-empty, non-heading, non-separator line
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---") || trimmed.startsWith("━")) continue;
            // Skip table headers and pure markdown formatting
            if (trimmed.startsWith("|") || trimmed.startsWith("```")) continue;
            return trimmed.replace(/^[>*•\-]\s*/, "").slice(0, 120);
        }
    } catch { /* ignore */ }
    return "";
}

function buildMap(dir: string, depth = 0): string[] {
    const lines: string[] = [];
    const indent = "  ".repeat(depth);
    let entries: string[];

    try {
        entries = readdirSync(dir).sort();
    } catch {
        return lines;
    }

    // Folders first, then files
    const folders = entries.filter((e) => {
        try { return statSync(join(dir, e)).isDirectory(); } catch { return false; }
    });
    const files = entries.filter((e) => {
        try { return statSync(join(dir, e)).isFile() && e.endsWith(".ts") && !e.endsWith(".d.ts"); } catch { return false; }
    });

    for (const folder of folders) {
        if (folder === "node_modules" || folder.startsWith(".")) continue;
        const folderPath = join(dir, folder);
        const desc = getFolderDescription(folderPath);
        const rel = relative(PROJECT_ROOT, folderPath);
        lines.push(`${indent}${rel}/${desc ? `  — ${desc}` : ""}`);
        lines.push(...buildMap(folderPath, depth + 1));
    }

    for (const file of files) {
        const filePath = join(dir, file);
        const desc = getFileDescription(filePath);
        const rel = relative(PROJECT_ROOT, filePath);
        lines.push(`${indent}${rel}${desc ? `  — ${desc}` : ""}`);
    }

    return lines;
}

export const project_sourcemap_tools = tool({
    description: "Returns a structured map of the src/ directory with one-line descriptions for every folder and file. Use this to quickly understand project structure and find where things live.",
    inputSchema: z.object({
        depth: z.number().optional().describe("Max folder depth to show. Default: unlimited."),
    }),
    execute: async (input) => {
        const lines = buildMap(SRC_DIR);
        const output = lines.join("\n");
        return {
            success: true,
            sourcemap: output || "No source files found in src/",
        };
    },
});
