/**
 * MCP config I/O — load and save MCP server configuration files.
 *
 * @module mcp/config-io
 */

import type { McpConfig } from './types';

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
