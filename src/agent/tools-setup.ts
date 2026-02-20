/**
 * Tool Registration — auto-discovers and registers all tools.
 *
 * Everything is auto-discovered from src/tools/:
 *   - Static tools (export const xxx = tool({...})) → immediate
 *   - Factory tools (export function register(deps)) → called with ToolDeps
 *   - MCP declarations (export const mcpServer) → stored for async init
 *
 * To add a new tool: create a file in src/tools/, export one of the above. Done.
 */

import { discoverAllTools } from '../tools/auto-loader';
import type { ToolDeps, McpDeclaration } from '../tools/deps';
import { enhanceToolSet } from '../tools/error-enhancer';
import type { Scheduler } from '../scheduler';
import type { McpConnector } from '../mcp/connector';
import type { MemoryManager } from '../memory';
import type { SurvivalMonitor } from '../survival';
import type { ChannelAuthStore } from '../channels/auth';
import type { ModelRouter } from '../llm/router';
import type { SubAgentDeps } from '../tools/agent-tool';

export interface RegistrationResult {
    subAgentDeps: SubAgentDeps;
    mcpServers: McpDeclaration[];
}

/** Register all tools into the toolSet. Returns sub-agent deps + MCP declarations for async init. */
export function registerDefaultTools(
    toolSet: Record<string, any>,
    scheduler: Scheduler,
    mcpConnector: McpConnector,
    mcpConfigPath: string,
    memory: MemoryManager,
    survival: SurvivalMonitor,
    channelAuth: ChannelAuthStore,
    router: ModelRouter,
): RegistrationResult {
    // Discover everything from src/tools/
    const { staticTools, factories, mcpServers } = discoverAllTools();

    // 1. Static tools — ready to use
    Object.assign(toolSet, staticTools);

    // 2. Factory tools — call each register(deps) and merge returned tools
    const deps: ToolDeps = {
        scheduler, router, survival, channelAuth,
        memory, mcpConnector, toolSet, mcpConfigPath,
    };

    for (const { file, register } of factories) {
        try {
            const tools = register(deps);
            if (tools && typeof tools === 'object') {
                Object.assign(toolSet, tools);
            }
        } catch (err) {
            console.error(`[Tools]: Factory register() failed in ${file}:`, err instanceof Error ? err.message : err);
        }
    }

    // 3. Snapshot built-in tool names BEFORE MCP bridge tools are loaded.
    //    Used by sub-agent prompt to distinguish MCP tools from builtins.
    const subAgentDeps: SubAgentDeps = deps.subAgentDeps ?? { router, toolSet };
    subAgentDeps.builtinToolNames = new Set(Object.keys(toolSet));

    // 4. Wrap all tools with error enhancement
    enhanceToolSet(toolSet);

    return { subAgentDeps, mcpServers };
}
