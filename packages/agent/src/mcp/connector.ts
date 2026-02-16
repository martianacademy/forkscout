/**
 * MCP Connector — Bridges external MCP servers into the agent's tool registry.
 *
 * Supports:
 *   - stdio transport (spawn a local process)
 *   - Auto-discovers tools from each connected server
 *   - Converts MCP tools to agent Tool format (with Zod schemas)
 *   - Graceful connect/disconnect lifecycle
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import type { Tool } from '../tools/registry';

// ─── Config types ───────────────────────────────────────

export interface McpServerConfig {
    /** The executable to spawn (e.g. "npx", "node", "python") */
    command: string;
    /** Arguments passed to the command */
    args?: string[];
    /** Extra environment variables */
    env?: Record<string, string>;
    /** Only register tools matching these names (if omitted, all tools) */
    toolFilter?: string[];
    /** Whether this server is enabled (default true) */
    enabled?: boolean;
}

export interface McpConfig {
    /** Named MCP servers */
    servers: Record<string, McpServerConfig>;
}

// ─── Connected server state ─────────────────────────────

interface ConnectedServer {
    name: string;
    client: Client;
    transport: StdioClientTransport;
    tools: Tool[];
}

// ─── Connector ──────────────────────────────────────────

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
     */
    async connectServer(name: string, config: McpServerConfig): Promise<Tool[]> {
        // Prevent duplicate connections
        if (this.servers.some(s => s.name === name)) {
            throw new Error(`MCP server "${name}" is already connected`);
        }

        const client = new Client(
            { name: `forkscout-${name}`, version: '1.0.0' },
        );

        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: config.env,
            stderr: 'pipe',
        });

        // Pipe stderr to console for debugging
        const stderr = transport.stderr;
        if (stderr && 'on' in stderr) {
            (stderr as any).on('data', (chunk: Buffer) => {
                const line = chunk.toString().trim();
                if (line) console.error(`[mcp:${name}] ${line}`);
            });
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
        // Build a Zod schema from the MCP JSON schema
        const zodSchema = this.jsonSchemaToZod(mcpTool.inputSchema);

        // Prefix tool name with server name to avoid collisions
        const toolName = `${serverName}_${mcpTool.name}`;

        return {
            name: toolName,
            description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
            parameters: zodSchema,
            execute: async (params: any) => {
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

                return texts.join('\n') || JSON.stringify(result);
            },
        };
    }

    /**
     * Convert a JSON Schema (from MCP) into a Zod schema.
     * Handles common types; falls back to z.any() for complex schemas.
     */
    private jsonSchemaToZod(schema?: any): z.ZodObject<any> {
        if (!schema || !schema.properties) {
            return z.object({});
        }

        const shape: Record<string, z.ZodTypeAny> = {};
        const required = new Set(schema.required || []);

        for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
            let field: z.ZodTypeAny;

            switch (prop.type) {
                case 'string':
                    field = z.string();
                    if (prop.enum) field = z.enum(prop.enum);
                    break;
                case 'number':
                case 'integer':
                    field = z.number();
                    break;
                case 'boolean':
                    field = z.boolean();
                    break;
                case 'array':
                    field = z.array(this.jsonSchemaTypeToZod(prop.items));
                    break;
                case 'object':
                    if (prop.properties) {
                        field = this.jsonSchemaToZod(prop);
                    } else {
                        field = z.record(z.any());
                    }
                    break;
                default:
                    field = z.any();
            }

            if (prop.description) {
                field = field.describe(prop.description);
            }

            if (!required.has(key)) {
                field = field.optional();
            }

            shape[key] = field;
        }

        return z.object(shape);
    }

    /**
     * Convert a single JSON schema type to a Zod type (for array items, etc.)
     */
    private jsonSchemaTypeToZod(schema?: any): z.ZodTypeAny {
        if (!schema) return z.any();

        switch (schema.type) {
            case 'string': return z.string();
            case 'number':
            case 'integer': return z.number();
            case 'boolean': return z.boolean();
            case 'object': return schema.properties ? this.jsonSchemaToZod(schema) : z.record(z.any());
            case 'array': return z.array(this.jsonSchemaTypeToZod(schema.items));
            default: return z.any();
        }
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

    /**
     * Disconnect all connected MCP servers.
     */
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

    /**
     * Get all connected server names.
     */
    getConnectedServers(): string[] {
        return this.servers.map(s => s.name);
    }

    /**
     * Get detailed info about connected servers.
     */
    getServerInfo(): Array<{ name: string; tools: string[] }> {
        return this.servers.map(s => ({
            name: s.name,
            tools: s.tools.map(t => t.name),
        }));
    }

    /**
     * Get all tools from connected servers.
     */
    getAllTools(): Tool[] {
        return this.servers.flatMap(s => s.tools);
    }
}

/**
 * Load MCP configuration from a JSON file.
 * Falls back to an empty config if the file doesn't exist.
 */
export async function loadMcpConfig(configPath: string): Promise<McpConfig> {
    try {
        const fs = await import('fs/promises');
        const raw = await fs.readFile(configPath, 'utf-8');
        return JSON.parse(raw) as McpConfig;
    } catch {
        return { servers: {} };
    }
}

/**
 * Save MCP configuration to a JSON file.
 */
export async function saveMcpConfig(configPath: string, config: McpConfig): Promise<void> {
    const fs = await import('fs/promises');
    const { dirname } = await import('path');
    await fs.mkdir(dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
