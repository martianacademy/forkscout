/**
 * Config barrel — re-exports all config types and functions.
 *
 * Existing imports like `from './config'` resolve here transparently
 * once the old config.ts monolith is deleted.
 *
 * @module config
 */

// Types & constants
export type { ProviderType, TierConfig, RouterConfig, BudgetConfig, McpServerEntry, AgentSettings, SubAgentConfig, ServerConfig, TelegramConfig, SearxngConfig, ForkscoutConfig, ProviderRouterPresets } from './types';
export { DEFAULTS, PROVIDER_URLS, PROVIDER_ROUTER_DEFAULTS } from './types';

// Loader & resolver
export { loadConfig, getConfig, resolveApiKeyForProvider, resolveApiUrlForProvider, watchConfig } from './loader';

// Builders (rarely needed externally but available)
export { resolveProvider, resolveProviderUrl, env, findConfigFile } from './builders';
