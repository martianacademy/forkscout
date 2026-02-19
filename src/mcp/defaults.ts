/**
 * MCP startup connection — reads config-based defaults + mcp.json overrides,
 * connects all servers, and converts their tools to AI SDK format.
 */

import { tool } from 'ai';
import { McpConnector, loadMcpConfig, type McpConfig, type McpServerConfig } from './connector';
import { getConfig, type McpServerEntry } from '../config';
import { enhanceToolSet } from '../tools/error-enhancer';

/**
 * Connect to all configured MCP servers and register their tools.
 *
 * Priority (highest wins):
 *   1. Inline mcpConfig (passed programmatically)
 *   2. mcp.json on disk
 *   3. agent.mcpServers from forkscout.config.json (defaults)
 */
export async function connectMcpServers(
    mcpConfig: McpConfig | undefined,
    mcpConfigPath: string,
    mcpConnector: McpConnector,
    toolSet: Record<string, any>,
): Promise<void> {
    let config: McpConfig;

    if (mcpConfig && typeof mcpConfig === 'object') {
        config = mcpConfig;
    } else {
        config = await loadMcpConfig(mcpConfigPath);
    }

    // Merge config-defined defaults (mcp.json / inline takes precedence)
    const configDefaults: Record<string, McpServerEntry> = getConfig().agent.mcpServers || {};
    for (const [name, entry] of Object.entries(configDefaults)) {
        if (!(name in config.servers) && entry.enabled !== false) {
            config.servers[name] = entry as McpServerConfig;
        }
    }

    const serverCount = Object.keys(config.servers).length;
    if (serverCount === 0) return;

    console.log(`\nConnecting to ${serverCount} MCP server(s)...`);
    const mcpTools = await mcpConnector.connect(config);

    // Convert MCP tools (custom format) → AI SDK tool() format
    const mcpToolNames: string[] = [];
    for (const t of mcpTools) {
        toolSet[t.name] = tool({
            description: t.description,
            inputSchema: t.parameters,
            execute: async (input: any) => t.execute(input),
        });
        mcpToolNames.push(t.name);
    }

    // Wrap MCP tools with error enhancer — these were added AFTER the
    // initial enhanceToolSet() call in tools-setup.ts, so they need
    // explicit wrapping to prevent unhandled throws from breaking the loop.
    if (mcpToolNames.length > 0) {
        const mcpSubset: Record<string, any> = {};
        for (const name of mcpToolNames) mcpSubset[name] = toolSet[name];
        enhanceToolSet(mcpSubset);
        // Write enhanced versions back
        for (const name of mcpToolNames) toolSet[name] = mcpSubset[name];
        console.log(`Registered ${mcpTools.length} MCP tool(s) (error-enhanced)\n`);
    }
}
