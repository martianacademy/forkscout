/**
 * ToolDeps — central dependency container for factory tool registration.
 *
 * Passed to `register(deps)` functions exported by factory tool files.
 * The auto-loader discovers these and calls them at startup.
 *
 * @module tools/deps
 */

import type { Scheduler } from '../scheduler';
import type { McpConnector } from '../mcp/connector';
import type { MemoryManager } from '../memory';
import type { SurvivalMonitor } from '../survival';
import type { ChannelAuthStore } from '../channels/auth';
import type { ModelRouter } from '../llm/router';
import type { SubAgentDeps } from './agent-tool';

export interface ToolDeps {
    scheduler: Scheduler;
    router: ModelRouter;
    survival: SurvivalMonitor;
    channelAuth: ChannelAuthStore;
    memory: MemoryManager;
    mcpConnector: McpConnector;
    /** Live toolSet reference — factory tools can read/mutate it */
    toolSet: Record<string, any>;
    /** Path to mcp.json for MCP config persistence */
    mcpConfigPath: string;

    // ── Outputs — set by factory register functions ──
    /** Populated by agent-tool's register(). Used by Agent for onProgress wiring. */
    subAgentDeps?: SubAgentDeps;
}

/**
 * MCP server declaration — exported from *.mcp.ts files in src/tools/.
 * The auto-loader discovers these and connects them during agent init.
 */
export interface McpDeclaration {
    /** Unique server name (used as tool name prefix) */
    name: string;
    /** Remote MCP server URL (for Streamable HTTP) */
    url?: string;
    /** Local command to spawn (for stdio transport) */
    command?: string;
    /** Arguments for the command */
    args?: string[];
    /** Extra environment variables */
    env?: Record<string, string>;
    /** HTTP headers for remote auth */
    headers?: Record<string, string>;
    /** Only register tools matching these names */
    toolFilter?: string[];
    /** Whether this server is enabled (default true) */
    enabled?: boolean;
}
