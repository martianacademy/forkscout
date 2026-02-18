/**
 * Forkscout Agent Engine
 *
 * Main entry point for the AI agent system with RAG and memory capabilities.
 */

import { Agent, type AgentConfig } from './agent';

// Export main classes
export { Agent, type AgentConfig, type ChatContext, type ChatChannel } from './agent';
export { LLMClient, type LLMConfig } from './llm/client';
export {
    MemoryManager,
    type MemoryConfig,
    type ContextResult,
    type SearchResult,
    type Entity,
    type EntityType,
    type Relation,
    type RelationType,
    RELATION_TYPES,
    SELF_ENTITY_NAME,
    buildFailureObservation,
} from './memory';
export { generateTextWithRetry, streamTextWithRetry, generateTextQuiet, type RetryConfig } from './llm/retry';
export { countTokens, truncateToTokens } from './utils/tokens';
export {
    coreTools,
    createSchedulerTools,
    createMcpTools,
    createSurvivalTools,
    createChannelAuthTools,
    createBudgetTools,
} from './tools/ai-tools';
export {
    ModelRouter,
    createRouterFromEnv,
    getModelPricing,
    type ModelPurpose,
    type ModelTier,
    type ModelTierConfig,
    type ModelPricing,
    type RouterConfig,
} from './llm/router';
export {
    loadConfig,
    getConfig,
    resolveApiKeyForProvider,
    resolveApiUrlForProvider,
    type ForkscoutConfig,
    type ProviderType,
    type TierConfig,
    type BudgetConfig,
    type AgentSettings,
    type SearxngConfig,
} from './config';
export { BudgetTracker, type BudgetData, type BudgetLimits, type BudgetStatus, type SpendRecord } from './llm/budget';
export { McpConnector, loadMcpConfig, type McpConfig, type McpServerConfig } from './mcp/connector';
export {
    createSurvivalMonitor,
    type SurvivalMonitor,
    type SurvivalStatus,
    type SurvivalConfig,
    type VitalSign,
    type ThreatEvent,
    type ThreatLevel,
} from './survival';
export { ChannelAuthStore, type ChannelGrant, type ChannelSession, type ChannelType } from './channels/auth';
export { TelegramBridge, type TelegramBridgeConfig } from './channels/telegram';
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
