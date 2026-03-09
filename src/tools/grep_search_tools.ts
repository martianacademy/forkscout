// src/tools/grep_search_tools.ts — Fast regex/text search across the codebase
import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";


interface GrepMatch {
    file: string;
    line: number;
    text: string;
}

function parseGrepOutput(raw: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        // format: file:line:content
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
            results.push({
                file: match[1],
                line: parseInt(match[2], 10),
                text: match[3].trim(),
            });
        }
    }
    return results;
}

export const grep_search = tool({
    description:
        "Search for text patterns or regexes across the codebase. Returns file paths, line numbers, and matched lines. " +
        "WHEN TO USE: finding where a function, class, constant, or import is used; " +
        "locating where a config key or error message appears; finding all usages before renaming something; " +
        "checking if a pattern exists without reading entire files. " +
        "WHEN NOT TO USE: finding files by name pattern — use file_search_tools; reading full file content — use read_file_tools. " +
        "Use 'include' to restrict to a file type: '*.ts', 'src/channels/**'. " +
        "Supports full regex: e.g. 'export const \\w+_tools' to find all tool exports. " +
        "Example: {pattern: 'buildIdentity', include: '*.ts'} finds all usages of buildIdentity in TypeScript files.",
    inputSchema: z.object({
        pattern: z.string().describe(
            "Text or regex pattern to search for, e.g. 'handleMessage' or 'import.*from.*api'"
        ),
        include: z.string().optional().describe(
            "Glob to restrict search, e.g. '*.ts' or 'src/tools/**'. Default: all files."
        ),
        exclude: z.string().optional().describe(
            "Glob to exclude from search, e.g. 'node_modules/**'"
        ),
        cwd: z.string().optional().describe(
            "Working directory to search from (default: project root)"
        ),
        max_results: z.number().int().min(1).max(200).default(50).describe(
            "Max number of matches to return (default: 50)"
        ),
        case_sensitive: z.boolean().default(false).describe(
            "Case-sensitive search (default: false)"
        ),
    }),
    execute: async (input) => {
        const {
            pattern,
            include,
            exclude,
            cwd = process.cwd(),
            max_results,
            case_sensitive,
        } = input;

        const flags = [
            "-rn",                          // recursive + line numbers
            "--color=never",
            case_sensitive ? "" : "-i",
            include ? `--include="${include}"` : "",
            exclude ? `--exclude-dir="${exclude}"` : "--exclude-dir=node_modules --exclude-dir=.git",
        ].filter(Boolean).join(" ");

        const cmd = `grep ${flags} "${pattern.replace(/"/g, '\\"')}" .`;

        try {
            const raw = execSync(cmd, {
                cwd,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
                timeout: 15000,
            });

            const matches = parseGrepOutput(raw).slice(0, max_results);
            return {
                success: true,
                pattern,
                total_shown: matches.length,
                matches,
            };
        } catch (err: any) {
            // grep exits 1 when no matches found — not an error
            if (err.status === 1) {
                return { success: true, pattern, total_shown: 0, matches: [] };
            }
            return {
                success: false,
                error: (err.stderr as string | undefined)?.trim() ?? (err as Error).message,
            };
        }
    },
});
