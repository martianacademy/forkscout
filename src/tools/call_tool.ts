// src/tools/call_tool.ts
// Executes any on-demand tool from .agents/tools/ by name.
//
// This is the companion to find_tools:
//   1. find_tools("compress text") → returns { name: "compress_text_tools", params: "text, method" }
//   2. call_tool("compress_text_tools", { text: "...", method: "..." }) → runs it and returns result
//
// This keeps .agents/tools/ hidden from the LLM context (saving ~2500-3000 tokens/turn)
// while still allowing on-demand execution of any extended tool.

import { tool } from "ai";
import { z } from "zod";
import { resolve } from "path";
import { existsSync } from "fs";
import { log } from "@/logs/logger.ts";
import { resolveSecrets, censorSecrets } from "@/secrets/vault.ts";

const logger = log("call_tool");

export const IS_BOOTSTRAP_TOOL = true;

const AGENTS_TOOLS_DIR = resolve(process.cwd(), ".agents", "tools");

/** Cache of loaded tool modules to avoid re-importing on every call */
const _moduleCache = new Map<string, any>();

async function getToolModule(toolName: string): Promise<Record<string, any> | null> {
    if (_moduleCache.has(toolName)) return _moduleCache.get(toolName);

    // Try <toolName>.ts directly
    const paths = [
        resolve(AGENTS_TOOLS_DIR, `${toolName}.ts`),
        // Also try without trailing _tools suffix variations
        resolve(AGENTS_TOOLS_DIR, `${toolName.replace(/_tools$/, "")}_tools.ts`),
        resolve(AGENTS_TOOLS_DIR, `${toolName.replace(/_tools$/, "")}.ts`),
    ];

    for (const p of paths) {
        if (existsSync(p)) {
            try {
                const mod = await import(p);
                _moduleCache.set(toolName, mod);
                return mod;
            } catch (err: any) {
                logger.error(`[call_tool] failed to import ${p}: ${err?.message}`);
                return null;
            }
        }
    }

    return null;
}

export const call_tool = tool({
    description:
        "Execute any on-demand tool from .agents/tools/ by name. " +
        "Use AFTER find_tools() returns a match. " +
        "Pass the exact tool name returned by find_tools and a JSON object of parameters. " +
        "Example: call_tool('compress_text_tools', { text: '...', method: 'summarize' }). " +
        "Do NOT use this for bootstrap tools already in your active list — call those directly.",
    inputSchema: z.object({
        tool_name: z.string().describe(
            "Exact tool name as returned by find_tools, e.g. 'compress_text_tools', 'git_operations_tools'"
        ),
        input: z.record(z.string(), z.unknown()).describe(
            "Input parameters for the tool as a JSON object. Must match the tool's params."
        ),
    }),
    execute: async ({ tool_name, input }) => {
        const mod = await getToolModule(tool_name);

        if (!mod) {
            return {
                success: false,
                error: `Tool '${tool_name}' not found in .agents/tools/. Use find_tools() to search for available tools.`,
                hint: "Run find_tools() with a description of what you need.",
            };
        }

        // Find the exported tool object (the one with an execute function)
        const toolExport = mod[tool_name] ?? Object.values(mod).find(
            (v: any) => typeof v?.execute === "function"
        );

        if (!toolExport || typeof toolExport.execute !== "function") {
            return {
                success: false,
                error: `Module loaded but no executable tool found for '${tool_name}'.`,
                hint: "The tool file may export under a different name. Use find_tools() to verify.",
            };
        }

        // Resolve {{secret:alias}} placeholders in input
        let resolvedInput = input;
        try {
            const raw = JSON.stringify(input);
            if (raw.includes("{{secret:")) {
                resolvedInput = JSON.parse(
                    raw.replace(
                        /\{\{secret:([a-zA-Z0-9_\-]+)\}\}/g,
                        (_, alias) => {
                            const val = resolveSecrets(`{{secret:${alias}}}`);
                            return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                        }
                    )
                );
            }
        } catch (err: any) {
            // Secret not found — return a structured error so the LLM knows to store it first.
            logger.warn(`[call_tool] secret resolution failed for '${tool_name}': ${err?.message ?? err}`);
            return {
                success: false,
                tool: tool_name,
                error: err?.message ?? String(err),
                hint: "Check the alias exists: call_tool('secret_vault_tools', { action: 'list' }). Store it: call_tool('secret_vault_tools', { action: 'store', alias: '<alias>', value: '<value>' })",
            };
        }

        try {
            const result = await toolExport.execute(resolvedInput);

            // Censor any secrets that leaked into the output
            try {
                const raw = typeof result === "string" ? result : JSON.stringify(result);
                const censored = censorSecrets(raw);
                if (censored !== raw) {
                    logger.warn(`[call_tool] censored secret value from '${tool_name}' output`);
                    return typeof result === "string" ? censored : JSON.parse(censored);
                }
            } catch { /* never break output on censor failure */ }

            return result;
        } catch (err: any) {
            logger.error(`[call_tool] ${tool_name} execute error: ${err?.message}`);
            return {
                success: false,
                tool: tool_name,
                error: err?.message ?? String(err),
                errorType: err?.constructor?.name ?? "Error",
                hint: "Check the tool parameters match what find_tools() reported.",
            };
        }
    },
});
