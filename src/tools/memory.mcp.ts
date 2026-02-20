/**
 * MCP: Forkscout Memory — persistent knowledge graph, entity store, task tracking.
 * Docker container, see docker-compose.yml for port.
 */
import { getConfig } from '../config';
import type { McpDeclaration } from './deps';

export const mcpServer: McpDeclaration = {
    name: 'forkscout-memory',
    get url() { return getConfig().agent.forkscoutMemoryMcpUrl || 'http://localhost:3211/mcp'; },
};
