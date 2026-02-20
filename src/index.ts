/**
 * Forkscout Agent Engine — entry point.
 *
 * This package is private. Only cli.ts and serve.ts consume this module.
 * Import directly from source files for anything not listed here.
 */

import { Agent, type AgentConfig } from './agent';

export { Agent, type AgentConfig } from './agent';
export { startServer, type ServerOptions } from './server';

/**
 * Create and initialize an agent instance.
 * Loads memory, connects MCP servers, starts survival monitor.
 */
export async function createAgent(config: AgentConfig): Promise<Agent> {
    const agent = new Agent(config);
    await agent.init();
    return agent;
}