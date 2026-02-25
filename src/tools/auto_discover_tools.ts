// src/tools/auto_discover_tools.ts
// Scans src/tools/ directory, imports all tool files, and builds tool sets.
// A tool file must export:
//   - IS_BOOTSTRAP_TOOL: boolean  — whether available at agent step 0
//   - A named const matching the file name  — the tool object itself

import { readdirSync } from "fs";
import { resolve } from "path";
import type { Tool } from "ai";

const SKIP_FILES = new Set(["index.ts", "auto_discover_tools.ts"]);

export interface DiscoveryResult {
    /** All tools combined — passed to the full agent tool loop */
    allTools: Record<string, Tool>;
    /** Only tools with IS_BOOTSTRAP_TOOL = true — available at step 0 */
    bootstrapTools: Record<string, Tool>;
}

export async function discoverTools(): Promise<DiscoveryResult> {
    // import.meta.dir is the absolute path to src/tools/ (Bun built-in)
    const toolsDir = import.meta.dir;

    const files = readdirSync(toolsDir).filter(
        (f) => f.endsWith(".ts") && !SKIP_FILES.has(f)
    );

    const allTools: Record<string, Tool> = {};
    const bootstrapTools: Record<string, Tool> = {};

    for (const file of files) {
        const mod = (await import(resolve(toolsDir, file))) as Record<
            string,
            unknown
        >;
        const isBootstrap = mod.IS_BOOTSTRAP_TOOL === true;

        for (const [key, value] of Object.entries(mod)) {
            if (key === "IS_BOOTSTRAP_TOOL") continue;
            // Detect a tool by checking for the inputSchema property
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
    }

    return { allTools, bootstrapTools };
}
