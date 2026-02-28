// src/tools/auto_discover_tools.ts
// Scans src/tools/ AND .agents/tools/ directories, imports all tool files, and builds tool sets.
// A tool file must export:
//   - IS_BOOTSTRAP_TOOL: boolean  — whether available at agent step 0
//   - A named const matching the file name  — the tool object itself
//
// Bootstrap tools live in src/tools/ (version-controlled).
// Non-bootstrap (extended) tools live in .agents/tools/ (gitignored, runtime-managed).

import { readdirSync, existsSync } from "fs";
import { resolve } from "path";
import type { Tool } from "ai";
import { log } from "@/logs/logger.ts";

const logger = log("tools:discovery");
const SKIP_FILES = new Set(["index.ts", "auto_discover_tools.ts"]);

export interface DiscoveryResult {
    /** All tools combined — passed to the full agent tool loop */
    allTools: Record<string, Tool>;
    /** Only tools with IS_BOOTSTRAP_TOOL = true — available at step 0 */
    bootstrapTools: Record<string, Tool>;
}

/**
 * Scan a single directory for tool files and register them.
 */
async function scanDirectory(
    dir: string,
    allTools: Record<string, Tool>,
    bootstrapTools: Record<string, Tool>
): Promise<void> {
    if (!existsSync(dir)) return;

    const files = readdirSync(dir).filter(
        (f) => f.endsWith(".ts") && !SKIP_FILES.has(f)
    );

    for (const file of files) {
        try {
            const mod = (await import(resolve(dir, file))) as Record<
                string,
                unknown
            >;
            const isBootstrap = mod.IS_BOOTSTRAP_TOOL === true;

            for (const [key, value] of Object.entries(mod)) {
                if (key === "IS_BOOTSTRAP_TOOL") continue;
                if (
                    typeof value === "object" &&
                    value !== null &&
                    "inputSchema" in value
                ) {
                    allTools[key] = value as Tool;
                    if (isBootstrap) {
                        bootstrapTools[key] = value as Tool;
                    }
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

    // 1. Scan bootstrap tools from src/tools/ (version-controlled)
    const coreDir = import.meta.dir;
    await scanDirectory(coreDir, allTools, bootstrapTools);

    // 2. Scan extended tools from .agents/tools/ (runtime-managed, gitignored)
    const extendedDir = resolve(process.cwd(), ".agents", "tools");
    await scanDirectory(extendedDir, allTools, bootstrapTools);

    logger.info(
        `Discovered ${Object.keys(allTools).length} tools (${Object.keys(bootstrapTools).length} bootstrap, ${Object.keys(allTools).length - Object.keys(bootstrapTools).length} extended)`
    );

    return { allTools, bootstrapTools };
}
