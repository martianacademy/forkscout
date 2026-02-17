/**
 * MCP Defaults — Built-in MCP servers and startup connection logic.
 *
 * Handles merging default servers with user config, connecting all servers,
 * and converting MCP tools to AI SDK tool() format.
 */

import { tool } from 'ai';
import { McpConnector, loadMcpConfig, type McpConfig, type McpServerConfig } from './connector';

/** Built-in MCP servers that are always available on startup */
export const DEFAULT_MCP_SERVERS: Record<string, McpServerConfig> = {
    'sequential-thinking': {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
    deepwiki: {
        url: 'https://mcp.deepwiki.com/mcp',
    },
};

/**
 * Connect to all configured MCP servers and register their tools.
 * Merges built-in defaults with user configuration (user config takes precedence).
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

    // Merge built-in defaults (user config takes precedence)
    for (const [name, cfg] of Object.entries(DEFAULT_MCP_SERVERS)) {
        if (!(name in config.servers)) {
            config.servers[name] = cfg;
        }
    }

    const serverCount = Object.keys(config.servers).length;
    if (serverCount === 0) return;

    console.log(`\nConnecting to ${serverCount} MCP server(s)...`);
    const mcpTools = await mcpConnector.connect(config);

    // Convert MCP tools (custom format) → AI SDK tool() format
    for (const t of mcpTools) {
        toolSet[t.name] = tool({
            description: t.description,
            inputSchema: t.parameters,
            execute: async (input: any) => t.execute(input),
        });
    }

    if (mcpTools.length > 0) {
        console.log(`Registered ${mcpTools.length} MCP tool(s)\n`);
    }
}
