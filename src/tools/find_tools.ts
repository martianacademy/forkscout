// src/tools/find_tools.ts
// Tool RAG — search over non-bootstrap tools by keyword.
//
// The LLM is only given bootstrap tools + find_tools + call_tool schemas.
// All other tools are hidden until the agent explicitly searches for them.
// This saves ~2500-3000 tokens per turn when tools aren't needed.
//
// Usage pattern:
//   1. Agent calls find_tools("search the web") → gets matching tool names + descriptions
//   2. Agent calls call_tool("web_search", { query: "..." }) → executes the real tool

import { tool } from "ai";
import { z } from "zod";
import { readdirSync } from "fs";
import { resolve } from "path";

export const IS_BOOTSTRAP_TOOL = true;

const SKIP_FILES = new Set([
    "index.ts",
    "auto_discover_tools.ts",
    "find_tools.ts",
    "call_tool.ts",
]);

interface ToolEntry {
    name: string;
    description: string;
    params: string;
}

/** Lazy-loaded cache — built once, reused across calls */
let _cache: ToolEntry[] | null = null;

async function loadNonBootstrapTools(): Promise<ToolEntry[]> {
    if (_cache) return _cache;

    const toolsDir = import.meta.dir;
    const files = readdirSync(toolsDir).filter(
        (f) => f.endsWith(".ts") && !SKIP_FILES.has(f)
    );

    const entries: ToolEntry[] = [];

    for (const file of files) {
        const mod = (await import(resolve(toolsDir, file))) as Record<string, unknown>;

        // Only index non-bootstrap tools
        if (mod.IS_BOOTSTRAP_TOOL === true) continue;

        for (const [key, value] of Object.entries(mod)) {
            if (key === "IS_BOOTSTRAP_TOOL") continue;
            if (
                typeof value !== "object" ||
                value === null ||
                !("inputSchema" in value) ||
                !("description" in value)
            ) continue;

            const t = value as { description: string; inputSchema: any };
            const params = extractParamNames(t.inputSchema);

            entries.push({
                name: key,
                description: String(t.description),
                params,
            });
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
        "Search for available tools by keyword. Call this when you need a capability that isn't in your bootstrap tools. Returns matching tool names, descriptions, and parameter names so you can then call them via call_tool.",
    inputSchema: z.object({
        query: z.string().describe(
            "Keywords describing what you want to do, e.g. 'read file', 'search web', 'write file'"
        ),
        limit: z.number().int().min(1).max(10).default(5).describe(
            "Max number of results to return (default 5)"
        ),
    }),
    execute: async (input) => {
        const tools = await loadNonBootstrapTools();

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
