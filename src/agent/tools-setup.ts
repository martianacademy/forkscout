/**
 * Tool Registration — wires all default tool groups into the agent's toolSet.
 */

import {
    coreTools,
    createSchedulerTools,
    createMcpTools,
    createMemoryTools,
    createSurvivalTools,
    createChannelAuthTools,
    createBudgetTools,
    createSelfRebuildTool,
} from '../tools/ai-tools';
import { enhanceToolSet } from '../tools/error-enhancer';
import type { Scheduler } from '../scheduler';
import type { McpConnector } from '../mcp/connector';
import type { MemoryManager } from '../memory';
import type { SurvivalMonitor } from '../survival';
import type { ChannelAuthStore } from '../channels/auth';
import type { ModelRouter } from '../llm/router';

/** Register all default tool groups into the toolSet */
export function registerDefaultTools(
    toolSet: Record<string, any>,
    scheduler: Scheduler,
    mcpConnector: McpConnector,
    mcpConfigPath: string,
    memory: MemoryManager,
    survival: SurvivalMonitor,
    channelAuth: ChannelAuthStore,
    router: ModelRouter,
): void {
    // Core tools (file, shell, web, utility)
    Object.assign(toolSet, coreTools);

    // Scheduler tools (cron jobs)
    Object.assign(toolSet, createSchedulerTools(scheduler));

    // MCP management tools (add/remove/list servers at runtime)
    Object.assign(
        toolSet,
        createMcpTools(
            mcpConnector,
            (newTools) => Object.assign(toolSet, newTools),
            (names) => {
                for (const n of names) delete toolSet[n];
            },
            mcpConfigPath,
        ),
    );

    // Memory tools (save/search/clear knowledge)
    Object.assign(toolSet, createMemoryTools(memory));

    // Survival tools (vitals, backup, status)
    Object.assign(toolSet, createSurvivalTools(survival));

    // Channel authorization tools (list/grant/revoke channel users)
    Object.assign(toolSet, createChannelAuthTools(channelAuth));

    // Budget & model tier tools (check spending, switch models)
    Object.assign(toolSet, createBudgetTools(router));

    // Self-rebuild tool (build from source + graceful restart)
    toolSet.self_rebuild = createSelfRebuildTool(() => memory.flush());

    // Wrap all tools with error enhancement — produces helpful diagnostics
    // instead of raw stack traces when tools fail
    enhanceToolSet(toolSet);
}
