/**
 * MCP types — configuration and connection state for MCP servers.
 *
 * @module mcp/types
 */

import type { Tool } from '../tools/registry';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ── Server config ──────────────────────────────────────

export interface McpServerConfig {
    /** The executable to spawn (e.g. "npx", "node", "python") — for local stdio */
    command?: string;
    /** Arguments passed to the command */
    args?: string[];
    /** Extra environment variables */
    env?: Record<string, string>;
    /** Remote server URL (e.g. "https://mcp.deepwiki.com/mcp") — for Streamable HTTP */
    url?: string;
    /** HTTP headers for remote auth (e.g. { Authorization: 'Bearer {{TOKEN}}' }) */
    headers?: Record<string, string>;
    /** Only register tools matching these names (if omitted, all tools) */
    toolFilter?: string[];
    /** Whether this server is enabled (default true) */
    enabled?: boolean;
}

export interface McpConfig {
    /** Named MCP servers */
    servers: Record<string, McpServerConfig>;
}

// ── Connected server state ─────────────────────────────

export interface ConnectedServer {
    name: string;
    client: Client;
    transport: StdioClientTransport | StreamableHTTPClientTransport;
    tools: Tool[];
}
