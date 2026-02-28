// src/mcp-servers/auto_discover_mcp.ts
// Scans src/mcp-servers/ AND .agents/mcp-servers/ for .json files and connects enabled MCP servers.
// 
// Core (versioned) MCP configs: src/mcp-servers/*.json
// Extended (runtime) configs: .agents/mcp-servers/*.json

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "@/tools/index.ts";
import { getConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("mcp");

export interface McpServerConfig {
    /** Server name — prefix for all tool names: `<name>__<tool>` */
    name: string;
    /** false = skip without deleting the file */
    enabled: boolean;
    /** stdio transport */
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    /** SSE (HTTP) transport */
    url?: string;
    /** HTTP headers — values support ${ENV_VAR} substitution from process.env */
    headers?: Record<string, string>;
}

let _cache: Record<string, Tool> | null = null;
let _configSnapshot = "";
let _activeClients: Client[] = [];

/** Scan a directory for .json MCP config files */
function scanMcpDir(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

/** Hash all JSON file contents from both dirs — changes trigger re-discovery */
function getConfigSnapshot(): string {
    const coreDir = import.meta.dir;
    const extendedDir = resolve(process.cwd(), ".agents", "mcp-servers");
    
    const allFiles = [...scanMcpDir(coreDir), ...scanMcpDir(extendedDir)].sort();
    
    try {
        return allFiles
            .map((f) => {
                const fullPath = f === scanMcpDir(coreDir)[0] // simple heuristic
                    ? resolve(coreDir, f)
                    : resolve(extendedDir, f);
                try {
                    return readFileSync(fullPath, "utf-8");
                } catch {
                    // try other dir
                    try {
                        return readFileSync(resolve(coreDir, f), "utf-8");
                    } catch {
                        return "";
                    }
                }
            })
            .join("|");
    } catch {
        return "";
    }
}

async function closeActiveClients(): Promise<void> {
    for (const client of _activeClients) {
        try {
            await client.close();
        } catch {
            // ignore disconnect errors during teardown
        }
    }
    _activeClients = [];
}

/** Force re-discovery on next call by clearing the cache */
export function forceReDiscover(): void {
    _cache = null;
    _configSnapshot = "";
}

/** Load and connect a single MCP server from a config file */
async function loadMcpServer(
    filePath: string,
    allTools: Record<string, Tool>
): Promise<void> {
    const config = getConfig();
    let mcpConfig: McpServerConfig;
    
    try {
        mcpConfig = JSON.parse(readFileSync(filePath, "utf-8")) as McpServerConfig;
    } catch (err) {
        logger.error(`Failed to parse ${filePath}:`, err);
        return;
    }

    if (!mcpConfig.enabled) return;
    if (!mcpConfig.name) {
        logger.warn(`${filePath}: missing 'name', skipping`);
        return;
    }

    try {
        const client = new Client({ 
            name: getConfig().agent.name.toLowerCase(), 
            version: "3.0.0" 
        }, {});

        if (mcpConfig.url) {
            // Resolve ${ENV_VAR} placeholders in header values
            const resolvedHeaders = mcpConfig.headers
                ? Object.fromEntries(
                    Object.entries(mcpConfig.headers).map(([k, v]) => [
                        k,
                        v.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? ""),
                    ])
                )
                : {};

            // Always include Accept: text/event-stream for SSE support
            const headers = {
                ...resolvedHeaders,
                Accept: "text/event-stream,application/json",
            };

            const transport = new StreamableHTTPClientTransport(
                new URL(mcpConfig.url),
                { requestInit: { headers } }
            );
            await client.connect(transport);
        } else if (mcpConfig.command) {
            const transport = new StdioClientTransport({
                command: mcpConfig.command,
                args: mcpConfig.args ?? [],
                env: mcpConfig.env
            });
            await client.connect(transport);
        } else {
            logger.warn(`"${mcpConfig.name}": no command or url, skipping`);
            return;
        }

        const { tools } = await client.listTools();

        for (const t of tools) {
            const toolName = `${mcpConfig.name}__${t.name}`;
            allTools[toolName] = tool({
                description: t.description ?? toolName,
                inputSchema: z.object({}).passthrough(),
                execute: async (input) => {
                    try {
                        // Merge default tool arguments from config
                        const defaultArgs = config.toolDefaults?.[toolName] ?? {};
                        const mergedInput = { ...defaultArgs, ...(input ?? {}) };

                        const result = await client.callTool({
                            name: t.name,
                            arguments: (mergedInput as Record<string, unknown>) ?? {}
                        });
                        return result;
                    } catch (err: any) {
                        logger.error(`Tool "${toolName}" failed:`, err?.message ?? err);
                        return { success: false, error: err?.message ?? "MCP tool call failed" };
                    }
                }
            });
        }

        logger.info(`"${mcpConfig.name}" connected — ${tools.length} tools loaded`);
        _activeClients.push(client);
    } catch (err) {
        logger.error(`Failed to connect "${mcpConfig.name}":`, err);
    }
}

export async function discoverMcpTools(): Promise<Record<string, Tool>> {
    const snapshot = getConfigSnapshot();
    if (_cache && snapshot === _configSnapshot) return _cache;

    // Config changed or first run — tear down stale connections
    if (_activeClients.length > 0) {
        logger.info("MCP config changed — reconnecting all servers");
        await closeActiveClients();
    }
    _cache = null;
    _configSnapshot = snapshot;

    // Core MCP configs (versioned): src/mcp-servers/
    const coreDir = import.meta.dir;
    const coreFiles = scanMcpDir(coreDir);
    
    // Extended MCP configs (runtime): .agents/mcp-servers/
    const extendedDir = resolve(process.cwd(), ".agents", "mcp-servers");
    const extendedFiles = scanMcpDir(extendedDir);

    const allTools: Record<string, Tool> = {};

    // Load core configs first
    for (const file of coreFiles) {
        await loadMcpServer(resolve(coreDir, file), allTools);
    }

    // Then load extended configs (can override core with same name)
    for (const file of extendedFiles) {
        await loadMcpServer(resolve(extendedDir, file), allTools);
    }

    _cache = allTools;
    return allTools;
}
