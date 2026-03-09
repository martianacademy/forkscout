// src/tools/find_tools.ts
// Tool RAG — search over on-demand tools in .agents/tools/ by keyword.
//
// The LLM is only given bootstrap tools (src/tools/) at step 0.
// All other tools live in .agents/tools/ and are hidden until explicitly searched.
// This saves ~2500-3000 tokens per turn when tools aren't needed.
//
// Usage pattern:
//   1. Agent calls find_tools("search the web") → gets matching tool names + descriptions
//   2. Agent calls call_tool("web_search", { query: "..." }) → executes the real tool

import { tool } from "ai";
import { z } from "zod";
import { readdirSync, existsSync } from "fs";
import { resolve } from "path";

const SKIP_FILES = new Set(["index.ts", "auto_discover_tools.ts", "find_tools.ts", "call_tool.ts"]);

const AGENTS_TOOLS_DIR = resolve(process.cwd(), ".agents", "tools");

interface ToolEntry {
    name: string;
    description: string;
    params: string;
}

/** Lazy-loaded cache — built once, reused across calls */
let _cache: ToolEntry[] | null = null;

async function loadOnDemandTools(): Promise<ToolEntry[]> {
    if (_cache) return _cache;

    if (!existsSync(AGENTS_TOOLS_DIR)) {
        _cache = [];
        return _cache;
    }

    const files = readdirSync(AGENTS_TOOLS_DIR).filter(
        (f) => f.endsWith(".ts") && !SKIP_FILES.has(f)
    );

    const entries: ToolEntry[] = [];

    for (const file of files) {
        const mod = (await import(resolve(AGENTS_TOOLS_DIR, file))) as Record<string, unknown>;

        for (const [key, value] of Object.entries(mod)) {
            if (
                typeof value !== "object" ||
                value === null ||
                !("inputSchema" in value) ||
                !("description" in value)
            ) continue;

            const t = value as { description: string; inputSchema: any };
            const params = extractParamNames(t.inputSchema);
            entries.push({ name: key, description: String(t.description), params });
        }
    }

    _cache = entries;
    return entries;
}

/** Extract top-level param names from a Zod schema for a compact summary */
function extractParamNames(schema: any): string {
    try {
        const shape = schema?._def?.shape?.();
        if (!shape) return "";
        return Object.keys(shape).join(", ");
    } catch {
        return "";
    }
}

/** Score a tool against a query — simple multi-word keyword match */
function score(entry: ToolEntry, query: string): number {
    const haystack = `${entry.name} ${entry.description}`.toLowerCase();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
}

export const find_tools = tool({
    description:
        "Search for on-demand tools in .agents/tools/ by keyword or exact tool name. " +
        "WHEN TO USE: (1) any time you need a capability not in your bootstrap tools; " +
        "(2) when a specific tool (e.g. validate_and_restart, web_browser_tools, telegram_message_tools, git_operations_tools, sqlite_tools, etc.) is not in your active tool list — search here before concluding it doesn't exist. " +
        "30+ extended tools are available: browser, git, SQLite, regex, PDF, image analysis, workers, cron, network scan, run_code, validate_and_restart, and more. " +
        "Returns tool name, full description, and parameter names — enough to call the tool immediately after. " +
        "WHEN NOT TO USE: for bootstrap tools already loaded (read_file_tools, edit_file_tools, run_shell_command_tools, web_search_tools, find_tools itself, etc.). " +
        "Do NOT use file_search_tools or project_sourcemap_tools to look for tools — use this. " +
        "Example queries: 'validate_and_restart', 'web browser', 'git commit', 'telegram message', 'sqlite database', 'parallel workers', 'schedule cron job'.",
    inputSchema: z.object({
        query: z.string().describe(
            "Keywords describing what you want to do, e.g. 'read file', 'search web', 'write file'"
        ),
        limit: z.number().int().min(1).max(10).default(5).describe(
            "Max number of results to return (default 5)"
        ),
    }),
    execute: async (input) => {
        const tools = await loadOnDemandTools();

        if (tools.length === 0) {
            return { success: true, results: [], message: "No non-bootstrap tools found." };
        }

        const scored = tools
            .map((t) => ({ ...t, score: score(t, input.query) }))
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, input.limit);

        const results = scored.map((t) => ({
            name: t.name,
            description: t.description,
            params: t.params || "(no params)",
        }));

        return {
            success: true,
            query: input.query,
            total_available: tools.length,
            results,
        };
    },
});
