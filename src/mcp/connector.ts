/**
 * MCP Connector — bridges external MCP servers into the agent's tool registry.
 *
 * Supports:
 *   - stdio transport (spawn a local process)
 *   - Streamable HTTP (remote servers via URL)
 *   - Auto-discovers tools from each connected server
 *   - Converts MCP tools to agent Tool format (with Zod schemas)
 *   - Graceful connect/disconnect lifecycle
 *
 * @module mcp/connector
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '../tools/registry';
import type { McpServerConfig, McpConfig, ConnectedServer } from './types';
import { jsonSchemaToZod } from './schema';

// Re-export types and I/O for backward compatibility
export type { McpServerConfig, McpConfig } from './types';
export { loadMcpConfig, saveMcpConfig } from './config-io';

// ── Connector class ─────────────────────────────────────

export class McpConnector {
    private servers: ConnectedServer[] = [];

    /**
     * Connect to all configured MCP servers and discover their tools.
     * Returns an array of Tools ready to register in the agent's ToolRegistry.
     */
    async connect(config: McpConfig): Promise<Tool[]> {
        const allTools: Tool[] = [];

        for (const [name, serverConfig] of Object.entries(config.servers)) {
            if (serverConfig.enabled === false) {
                console.log(`MCP server "${name}" is disabled, skipping`);
                continue;
            }

            try {
                const tools = await this.connectServer(name, serverConfig);
                allTools.push(...tools);
                console.log(`MCP server "${name}": ${tools.length} tool(s) — ${tools.map(t => t.name).join(', ')}`);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`MCP server "${name}" failed to connect: ${msg}`);
            }
        }

        return allTools;
    }

    /**
     * Connect to a single MCP server and return its tools.
     * Public so the agent can hot-add servers at runtime.
     * Supports local stdio OR remote Streamable HTTP.
     */
    async connectServer(name: string, config: McpServerConfig): Promise<Tool[]> {
        // Prevent duplicate connections
        if (this.servers.some(s => s.name === name)) {
            throw new Error(`MCP server "${name}" is already connected`);
        }

        const client = new Client(
            { name: `forkscout-${name}`, version: '1.0.0' },
        );

        let transport: StdioClientTransport | StreamableHTTPClientTransport;

        if (config.url) {
            // Remote Streamable HTTP
            transport = new StreamableHTTPClientTransport(
                new URL(config.url),
                { requestInit: config.headers ? { headers: config.headers } : undefined },
            );
        } else if (config.command) {
            // Local stdio
            transport = new StdioClientTransport({
                command: config.command,
                args: config.args ?? [],
                env: config.env,
                stderr: 'pipe',
            });

            // Pipe stderr to console for debugging
            const stderr = (transport as any).stderr;
            if (stderr && 'on' in stderr) {
                stderr.on('data', (chunk: Buffer) => {
                    const line = chunk.toString().trim();
                    if (line) console.error(`[mcp:${name}] ${line}`);
                });
            }
        } else {
            throw new Error(`MCP server "${name}": Must provide either 'command' (local) or 'url' (remote)`);
        }

        await client.connect(transport);

        // Discover tools
        const { tools: mcpTools } = await client.listTools();

        // Convert MCP tools → agent Tools
        const tools: Tool[] = [];
        for (const mcpTool of mcpTools) {
            // Apply tool filter
            if (config.toolFilter && !config.toolFilter.includes(mcpTool.name)) {
                continue;
            }

            const tool = this.bridgeTool(name, mcpTool, client);
            tools.push(tool);
        }

        this.servers.push({ name, client, transport, tools });
        return tools;
    }

    /**
     * Convert an MCP tool definition into the agent's Tool interface.
     */
    private bridgeTool(
        serverName: string,
        mcpTool: { name: string; description?: string; inputSchema?: any },
        client: Client,
    ): Tool {
        const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);
        const toolName = `${serverName}_${mcpTool.name}`;

        return {
            name: toolName,
            description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
            parameters: zodSchema,
            execute: async (params: any) => {
                try {
                    const result = await client.callTool({
                        name: mcpTool.name,
                        arguments: params,
                    });

                    // MCP returns content array — extract text
                    const texts: string[] = [];
                    if (result.content && Array.isArray(result.content)) {
                        for (const item of result.content as any[]) {
                            if (item.type === 'text') {
                                texts.push(item.text);
                            } else if (item.type === 'resource') {
                                texts.push(JSON.stringify(item.resource));
                            }
                        }
                    }

                    // Check for MCP-level error flag
                    if ((result as any).isError) {
                        const errorText = texts.join('\n') || JSON.stringify(result);
                        return `⚠️ TOOL ERROR in "${toolName}" (MCP)\nError: ${errorText}\n\nNEXT STEPS: The MCP tool reported an error. Check your parameters and try again with corrected input.`;
                    }

                    return texts.join('\n') || JSON.stringify(result);
                } catch (error) {
                    // Return structured error instead of throwing — prevents breaking the tool loop
                    const errMsg = error instanceof Error ? error.message : String(error);
                    const isConnectionError = /ECONNREFUSED|EPIPE|socket|disconnected|transport|closed/i.test(errMsg);
                    const guide = isConnectionError
                        ? `The MCP server "${serverName}" appears to be down or disconnected. Check if it is running, then retry.`
                        : `The MCP tool failed. Read the error message, verify your parameters, and try again.`;
                    return `⚠️ TOOL ERROR in "${toolName}" (MCP:${serverName})\nError: ${errMsg}\n\nNEXT STEPS: ${guide}\nDo NOT retry the same call without understanding why it failed first.`;
                }
            },
        };
    }

    /**
     * Disconnect a single MCP server by name.
     * Returns the tool names that were unregistered.
     */
    async disconnectServer(name: string): Promise<string[]> {
        const idx = this.servers.findIndex(s => s.name === name);
        if (idx === -1) {
            throw new Error(`MCP server "${name}" is not connected`);
        }

        const server = this.servers[idx];
        const toolNames = server.tools.map(t => t.name);

        try {
            await server.client.close();
        } catch {
            // ignore
        }

        this.servers.splice(idx, 1);
        console.log(`MCP server "${name}" disconnected (tools removed: ${toolNames.join(', ')})`);
        return toolNames;
    }

    /** Disconnect all connected MCP servers. */
    async disconnect(): Promise<void> {
        for (const server of this.servers) {
            try {
                await server.client.close();
                console.log(`MCP server "${server.name}" disconnected`);
            } catch {
                // ignore — process may have already exited
            }
        }
        this.servers = [];
    }

    /** Get all connected server names. */
    getConnectedServers(): string[] {
        return this.servers.map(s => s.name);
    }

    /** Get detailed info about connected servers. */
    getServerInfo(): Array<{ name: string; tools: string[] }> {
        return this.servers.map(s => ({
            name: s.name,
            tools: s.tools.map(t => t.name),
        }));
    }

    /** Get all tools from connected servers. */
    getAllTools(): Tool[] {
        return this.servers.flatMap(s => s.tools);
    }
}
