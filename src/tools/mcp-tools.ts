/**
 * MCP server management tools — add, remove, list MCP servers at runtime.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { McpConnector, loadMcpConfig, saveMcpConfig, type McpServerConfig } from '../mcp/connector';
import { enhanceToolSet } from './error-enhancer';

export function createMcpTools(
    connector: McpConnector,
    addToolsFn: (tools: Record<string, any>) => void,
    removeToolsFn: (names: string[]) => void,
    configPath: string,
) {
    return {
        add_mcp_server: tool({
            description: 'Add and connect a new MCP server at runtime. Its tools are discovered and registered automatically. Provide EITHER command (local stdio) OR url (remote HTTP/SSE).',
            inputSchema: z.object({
                name: z.string().describe('Unique name for this server'),
                command: z.string().optional().describe('The command to run for local servers (e.g. "npx", "node")'),
                args: z.array(z.string()).optional().describe('Arguments for the command'),
                env: z.record(z.string()).optional().describe('Extra environment variables'),
                url: z.string().optional().describe('Remote MCP server URL (e.g. "https://mcp.deepwiki.com/mcp")'),
                headers: z.record(z.string()).optional().describe('HTTP headers for remote auth'),
            }),
            execute: async ({ name, command, args, env, url, headers }) => {
                const serverConfig: McpServerConfig = { command, args, env, url, headers, enabled: true };
                const mcpTools = await connector.connectServer(name, serverConfig);

                // Convert MCP tools to AI SDK format, enhance, and register
                const aiTools: Record<string, any> = {};
                for (const t of mcpTools) {
                    aiTools[t.name] = tool({
                        description: t.description,
                        inputSchema: t.parameters,
                        execute: async (input: any) => t.execute(input),
                    });
                }
                // Wrap with error enhancer — dynamically-added tools miss
                // the initial enhanceToolSet() call from tools-setup.ts
                enhanceToolSet(aiTools);
                addToolsFn(aiTools);

                // Persist config
                const config = await loadMcpConfig(configPath);
                config.servers[name] = serverConfig;
                await saveMcpConfig(configPath, config);

                return `Connected MCP server "${name}" — ${mcpTools.length} tool(s): ${mcpTools.map(t => t.name).join(', ')}`;
            },
        }),

        remove_mcp_server: tool({
            description: 'Disconnect an MCP server and remove its tools.',
            inputSchema: z.object({
                name: z.string().describe('Name of the MCP server to disconnect'),
                keepInConfig: z.boolean().optional().describe('If true, keep in config as disabled'),
            }),
            execute: async ({ name, keepInConfig }) => {
                const removedToolNames = await connector.disconnectServer(name);
                removeToolsFn(removedToolNames);

                const config = await loadMcpConfig(configPath);
                if (keepInConfig) {
                    if (config.servers[name]) config.servers[name].enabled = false;
                } else {
                    delete config.servers[name];
                }
                await saveMcpConfig(configPath, config);

                return `Disconnected MCP server "${name}" — removed tools: ${removedToolNames.join(', ')}`;
            },
        }),

        list_mcp_servers: tool({
            description: 'List all connected MCP servers and their tools.',
            inputSchema: z.object({}),
            execute: async () => {
                const info = connector.getServerInfo();
                if (info.length === 0) return 'No MCP servers connected.';
                return info.map(s => `${s.name}: ${s.tools.join(', ')}`).join('\n');
            },
        }),
    };
}
