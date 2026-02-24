// src/mcp/index.ts — MCP server connector
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool } from "ai";
import { z } from "zod";
import type { AppConfig } from "../config.ts";
import type { Tool } from "../tools/index.ts";

let _mcpTools: Record<string, Tool> | null = null;

export async function connectMcpTools(
    config: AppConfig
): Promise<Record<string, Tool>> {
    if (_mcpTools) return _mcpTools;

    const servers = config.mcp.servers;
    const allTools: Record<string, Tool> = {};

    for (const [name, serverConfig] of Object.entries(servers)) {
        try {
            if (!serverConfig.command) {
                console.warn(`[mcp] Server "${name}" has no command, skipping`);
                continue;
            }

            const transport = new StdioClientTransport({
                command: serverConfig.command,
                args: serverConfig.args ?? [],
                env: serverConfig.env,
            });

            const client = new Client({ name: "forkscout", version: "3.0.0" }, {});
            await client.connect(transport);

            const { tools } = await client.listTools();

            for (const t of tools) {
                const toolName = `${name}__${t.name}`;
                allTools[toolName] = tool({
                    description: t.description ?? toolName,
                    inputSchema: z.record(z.unknown()),
                    execute: async (input) => {
                        const result = await client.callTool({
                            name: t.name,
                            arguments: (input as Record<string, unknown>) ?? {},
                        });
                        return result;
                    },
                });
            }

            console.log(`[mcp] Connected to "${name}", loaded ${tools.length} tools`);
        } catch (err) {
            console.error(`[mcp] Failed to connect to "${name}":`, err);
        }
    }

    _mcpTools = allTools;
    return allTools;
}
