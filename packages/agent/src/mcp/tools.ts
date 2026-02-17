/**
 * MCP Management Tools — Let the agent add/remove/list MCP servers at runtime.
 *
 * These tools give the agent the ability to:
 *   - Hot-connect new MCP servers (and persist the config)
 *   - Disconnect running MCP servers
 *   - List all connected servers and their tools
 */

import { z } from 'zod';
import type { Tool } from '../tools/registry';
import type { ToolRegistry } from '../tools/registry';
import { McpConnector, loadMcpConfig, saveMcpConfig, type McpServerConfig } from './connector';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';

/**
 * Create tools for runtime MCP server management.
 *
 * @param connector  The active McpConnector instance
 * @param toolRegistry  The agent's tool registry (to register/unregister tools)
 * @param configPath  Path to the mcp.json config file (for persistence)
 */
export function createMcpManagementTools(
    connector: McpConnector,
    toolRegistry: ToolRegistry,
    configPath?: string,
): Tool[] {
    const mcpConfigPath = configPath
        || resolvePath(AGENT_ROOT, '.forkscout', 'mcp.json');

    // ─── add_mcp_server ────────────────────────────────

    const addMcpServer: Tool = {
        name: 'add_mcp_server',
        description: 'Add and connect a new MCP server at runtime. The server is spawned, its tools are discovered and registered, and the config is saved to disk so the server persists across restarts.',
        parameters: z.object({
            name: z.string().describe('Unique name for this server (e.g. "github", "filesystem", "brave-search")'),
            command: z.string().optional().describe('The command to run for local servers (e.g. "npx", "node", "python", "uvx")'),
            args: z.array(z.string()).optional().describe('Arguments for the command (e.g. ["-y", "@modelcontextprotocol/server-github"])'),
            env: z.record(z.string()).optional().describe('Extra environment variables (e.g. {"GITHUB_TOKEN": "ghp_xxx"})'),
            url: z.string().optional().describe('Remote MCP server URL (e.g. "https://mcp.deepwiki.com/mcp")'),
            headers: z.record(z.string()).optional().describe('HTTP headers for remote auth (e.g. {"Authorization": "Bearer xxx"})'),
        }),
        execute: async (params: { name: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }) => {
            const serverConfig: McpServerConfig = {
                command: params.command,
                args: params.args,
                env: params.env,
                url: params.url,
                headers: params.headers,
                enabled: true,
            };

            // Connect to the server
            const tools = await connector.connectServer(params.name, serverConfig);

            // Register discovered tools in the agent's registry
            for (const tool of tools) {
                toolRegistry.register(tool);
            }

            // Persist to config file
            const config = await loadMcpConfig(mcpConfigPath);
            config.servers[params.name] = serverConfig;
            await saveMcpConfig(mcpConfigPath, config);

            const toolNames = tools.map(t => t.name);
            return {
                success: true,
                serverName: params.name,
                toolsRegistered: toolNames,
                message: `Connected MCP server "${params.name}" — ${tools.length} tool(s) available: ${toolNames.join(', ')}. Config saved to ${mcpConfigPath}.`,
            };
        },
    };

    // ─── remove_mcp_server ────────────────────────────

    const removeMcpServer: Tool = {
        name: 'remove_mcp_server',
        description: 'Disconnect an MCP server and remove it from the persistent config. All its tools become unavailable.',
        parameters: z.object({
            name: z.string().describe('Name of the MCP server to disconnect'),
            keepInConfig: z.boolean().optional().describe('If true, keep the server in config (disabled) instead of removing entirely'),
        }),
        execute: async (params: { name: string; keepInConfig?: boolean }) => {
            // Disconnect and get removed tool names
            const removedTools = await connector.disconnectServer(params.name);

            // Unregister tools from the agent's registry
            for (const toolName of removedTools) {
                toolRegistry.unregister(toolName);
            }

            // Update config file
            const config = await loadMcpConfig(mcpConfigPath);
            if (params.keepInConfig) {
                if (config.servers[params.name]) {
                    config.servers[params.name].enabled = false;
                }
            } else {
                delete config.servers[params.name];
            }
            await saveMcpConfig(mcpConfigPath, config);

            return {
                success: true,
                serverName: params.name,
                toolsRemoved: removedTools,
                message: `Disconnected MCP server "${params.name}" — removed ${removedTools.length} tool(s). ${params.keepInConfig ? 'Kept in config (disabled).' : 'Removed from config.'}`,
            };
        },
    };

    // ─── list_mcp_servers ─────────────────────────────

    const listMcpServers: Tool = {
        name: 'list_mcp_servers',
        description: 'List all connected MCP servers, their tools, and the config file contents.',
        parameters: z.object({}),
        execute: async () => {
            const connected = connector.getServerInfo();
            const config = await loadMcpConfig(mcpConfigPath);

            return {
                connectedServers: connected,
                configuredServers: Object.keys(config.servers).map(name => ({
                    name,
                    enabled: config.servers[name].enabled !== false,
                    command: config.servers[name].command,
                    args: config.servers[name].args,
                })),
                configPath: mcpConfigPath,
                totalConnected: connected.length,
                totalTools: connected.reduce((sum, s) => sum + s.tools.length, 0),
            };
        },
    };

    return [addMcpServer, removeMcpServer, listMcpServers];
}
