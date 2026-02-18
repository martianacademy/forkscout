/**
 * Forkscout Agent Engine
 * 
 * Main entry point for the AI agent system with RAG and memory capabilities.
 */

import { Agent, type AgentConfig } from './agent';

// Export main classes
export { Agent, type AgentConfig, type ChatContext, type ChatChannel } from './agent';
export { LLMClient, type LLMConfig } from './llm/client';
export { MemoryManager, type MemoryConfig } from './memory/manager';
export { VectorStore, type MemoryChunk } from './memory/vector-store';
export {
    type GraphState, createGraphState,
    type Entity, type Relation, type GraphData, type EntityType,
    type MemoryStage, type Evidence, type Observation, type RelationType,
    RELATION_TYPES, STAGE_WEIGHTS, SELF_ENTITY_NAME,
    computeConfidence, computeWeight, freshEvidence, normalizeRelationType,
    initGraph, flushGraph, clearGraph,
    addEntity, getEntity, addObservations, updateSessionContext, deleteEntity,
    getSelfEntity, addSelfObservation,
    addRelation, deleteRelation,
    searchGraph, getNeighbors, traverseGraph,
    mergeExtracted, formatForContext,
    getAllEntities, getAllRelations, getMeta,
    entityCount, relationCount,
    setEntity, setRelations,
    markConsolidated, needsConsolidation,
    buildExtractionPrompt,
} from './memory/knowledge-graph';
export { SkillStore, type Skill, type SkillData } from './memory/skills';
export { Consolidator, type ConsolidationConfig, type ConsolidationResult } from './memory/consolidator';
export { generateTextWithRetry, streamTextWithRetry, generateTextQuiet, type RetryConfig } from './llm/retry';
export { countTokens, truncateToTokens } from './utils/tokens';
export {
    classifySituation, domainBoost, observationDomainBoost,
    buildAccessContext, registerDomain, getDomain, listDomains, domainCount,
    type LifeDomain, type BuiltInDomain, type SituationModel, type AccessContext,
    type DomainDescriptor, BUILT_IN_DOMAINS, ENTITY_DOMAIN_AFFINITY,
} from './memory/situation';
export { coreTools, createSchedulerTools, createMcpTools, createMemoryTools, createSurvivalTools, createChannelAuthTools, createBudgetTools } from './tools/ai-tools';
export { ModelRouter, createRouterFromEnv, getModelPricing, type ModelPurpose, type ModelTier, type ModelTierConfig, type ModelPricing, type RouterConfig } from './llm/router';
export { loadConfig, getConfig, resolveApiKeyForProvider, resolveApiUrlForProvider, type ForkscoutConfig, type ProviderType, type TierConfig, type BudgetConfig, type AgentSettings, type SearxngConfig } from './config';
export { BudgetTracker, type BudgetData, type BudgetLimits, type BudgetStatus, type SpendRecord } from './llm/budget';
export { McpConnector, loadMcpConfig, type McpConfig, type McpServerConfig } from './mcp/connector';
export { createSurvivalMonitor, type SurvivalMonitor, type SurvivalStatus, type SurvivalConfig, type VitalSign, type ThreatEvent, type ThreatLevel } from './survival';
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

