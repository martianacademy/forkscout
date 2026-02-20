/**
 * MCP: Sequential Thinking — structured step-by-step reasoning.
 */
import type { McpDeclaration } from './deps';

export const mcpServer: McpDeclaration = {
    name: 'sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
};
