/**
 * Agent Factories — constructor helpers for creating subsystems.
 * Keeps the Agent constructor focused on wiring, not configuration.
 */

import { LLMClient } from '../llm/client';
import { ModelRouter } from '../llm/router';
import { MemoryManager } from '../memory';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';
import { getConfig } from '../config';

/** Create a configured MemoryManager connected to the Forkscout Memory MCP Server */
export function createMemoryManager(_llm: LLMClient, _router: ModelRouter): MemoryManager {
    const storagePath = resolvePath(AGENT_ROOT, '.forkscout');
    const config = getConfig();
    const mcpUrl = config.agent.forkscoutMemoryMcpUrl || process.env.MEMORY_MCP_URL;

    return new MemoryManager({
        storagePath,
        ownerName: config.agent.owner,
        recentWindowSize: 20,
        contextBudget: 8000,
        mcpUrl,
    });
}
