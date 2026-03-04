// src/tools/auto_discover_tools.ts
// Scans src/tools/ AND .agents/tools/ directories, imports all tool files, and builds tool sets.
// A tool file must export:
//   - A named const — the tool object itself
//
// Bootstrap tools live in src/tools/ (version-controlled) — ALL are bootstrap.
// On-demand tools live in .agents/tools/ (gitignored, runtime-managed) — NONE are bootstrap.

import { readdirSync, existsSync } from "fs";
import { resolve } from "path";
import type { Tool } from "ai";
import { log } from "@/logs/logger.ts";
import { redactOutput } from "@/utils/redact.ts";

const logger = log("tools:discovery");
const SKIP_FILES = new Set(["index.ts", "auto_discover_tools.ts"]);

export interface DiscoveryResult {
    /** All tools combined — passed to the full agent tool loop */
    allTools: Record<string, Tool>;
    /** Tools from src/tools/ — always available at step 0 */
    bootstrapTools: Record<string, Tool>;
}

/**
 * Wrap a tool's execute function to redact sensitive data from its output.
 * Returns a new tool object — does not mutate the original.
 * If the tool has no execute (schema-only), returns it unchanged.
 */
function wrapToolWithRedaction(tool: Tool): Tool {
    const orig = tool as Record<string, unknown>;
    const originalExecute = orig.execute;

    if (typeof originalExecute !== "function") return tool;

    return {
        ...tool,
        execute: async (...args: unknown[]) => {
            const result = await (originalExecute as Function)(...args);
            return redactOutput(result);
        },
    } as Tool;
}

/**
 * Scan a directory for tool files and register them.
 * @param isBootstrapDir — if true, all tools in this dir are added to bootstrapTools too.
 */
async function scanDirectory(
    dir: string,
    allTools: Record<string, Tool>,
    bootstrapTools: Record<string, Tool>,
    isBootstrapDir: boolean
): Promise<void> {
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter(
        (f) => f.endsWith(".ts") && !SKIP_FILES.has(f)
    );

    for (const file of files) {
        try {
            const mod = (await import(resolve(dir, file))) as Record<string, unknown>;

            for (const [key, value] of Object.entries(mod)) {
                if (
                    typeof value === "object" &&
                    value !== null &&
                    "inputSchema" in value
                ) {
                    const wrapped = wrapToolWithRedaction(value as Tool);
                    allTools[key] = wrapped;
                    if (isBootstrapDir) bootstrapTools[key] = wrapped;
                }
            }
        } catch (err) {
            logger.error(`Failed to load tool file ${file}: ${err}`);
        }
    }
}

export async function discoverTools(): Promise<DiscoveryResult> {
    const allTools: Record<string, Tool> = {};
    const bootstrapTools: Record<string, Tool> = {};

    // 1. src/tools/ — all are bootstrap (version-controlled)
    const coreDir = import.meta.dir;
    await scanDirectory(coreDir, allTools, bootstrapTools, true);

    // 2. .agents/tools/ — all are on-demand (runtime-managed, gitignored)
    const extendedDir = resolve(process.cwd(), ".agents", "tools");
    await scanDirectory(extendedDir, allTools, bootstrapTools, false);

    logger.info(
        `Discovered ${Object.keys(allTools).length} tools (${Object.keys(bootstrapTools).length} bootstrap, ${Object.keys(allTools).length - Object.keys(bootstrapTools).length} extended)`
    );

    return { allTools, bootstrapTools };
}

// Re-export Tool type so consumers only need one import path
export type { Tool } from "ai";
