/**
 * Config types — shared type definitions, defaults, and constants.
 *
 * All config-related interfaces live here so they can be imported
 * independently without pulling in the loader or builder logic.
 *
 * @module config/types
 */

// ── Provider types ─────────────────────────────────────

export type ProviderType = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'github' | 'copilot-bridge' | 'ollama' | 'openai-compatible';

// ── Tier & Router ──────────────────────────────────────

export interface TierConfig {
    model: string;
    provider?: ProviderType;
    baseURL?: string;
}

export interface RouterConfig {
    fast: TierConfig;
    balanced: TierConfig;
    powerful: TierConfig;
}

/**
 * Per-provider router presets.
 * Maps each provider to its own fast/balanced/powerful tier models.
 * The active provider's preset is resolved at config load time.
 */
export type ProviderRouterPresets = Partial<Record<ProviderType, RouterConfig>>;


// ── MCP servers ────────────────────────────────────────

export interface McpServerEntry {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
}

// ── Sub-agent settings ─────────────────────────────────

export interface SubAgentConfig {
    /** Max steps per sub-agent run */
    maxSteps: number;
    /** Timeout per sub-agent in ms */
    timeoutMs: number;
    /** Max concurrent sub-agents in a batch */
    maxParallel: number;
    /** Model tier to use: 'fast', 'balanced', or 'powerful' */
    tier: 'fast' | 'balanced' | 'powerful';
    /** Number of retry attempts on failure */
    retryAttempts: number;
    /** Initial retry delay in ms (doubles on each attempt) */
    retryDelayMs: number;
    /** Max chars per tool output in extractFromSteps (truncation limit) */
    outputMaxLength: number;
    /** Default sampling temperature for sub-agents (0.0–1.0). Per-agent override takes priority. */
    temperature: number;
    /** Max time in ms for an entire batch of sub-agents. 0 = no batch timeout (rely on per-agent timeouts). */
    batchTimeoutMs: number;
}

// ── Server settings ────────────────────────────────────

export interface ServerConfig {
    /** Rate limit for localhost requests per window */
    rateLimitLocal: number;
    /** Rate limit for remote IP requests per window */
    rateLimitRemote: number;
    /** Rate limit window duration in ms */
    rateLimitWindowMs: number;
    /** Max request body size in bytes */
    maxBodyBytes: number;
}

// ── Telegram settings ──────────────────────────────────

export interface TelegramConfig {
    /** Max inbox messages to keep in state */
    maxInbox: number;
    /** Max chat history messages per conversation */
    maxHistory: number;
}

// ── Agent settings ─────────────────────────────────────

export interface AgentSettings {
    maxIterations: number;
    maxSteps: number;
    autoRegisterTools: boolean;
    port: number;
    /** Owner/creator name used in knowledge graph bootstrap and identity references */
    owner: string;
    /** App name shown in provider dashboards (e.g. OpenRouter) */
    appName: string;
    /** App URL shown in provider dashboards (HTTP-Referer header) */
    appUrl: string;
    /** Built-in MCP servers to connect on startup */
    mcpServers: Record<string, McpServerEntry>;
    /** Optional URL to a remote Memory MCP server (e.g. http://localhost:3211/mcp).
     *  When set, all memory reads/writes go through the MCP server — no local file I/O. */
    forkscoutMemoryMcpUrl?: string;
    /** Sub-agent configuration */
    subAgent: SubAgentConfig;
    /** HTTP server configuration */
    server: ServerConfig;
    /** Telegram channel configuration */
    telegram: TelegramConfig;
    /** Number of consecutive tool failures before tier escalation */
    failureEscalationThreshold: number;
    /** Browser idle timeout in ms before closing headless browser */
    browserIdleMs: number;
    /** Activity log max size in bytes before rotation */
    activityLogMaxBytes: number;
    /** Max times same tool can fail before stopping. 0 = disabled. (stop condition) */
    maxToolRetries: number;
    /** Step number after which to start pruning old tool results from context. 0 = disabled. */
    contextPruneAfterStep: number;
    /** Number of recent messages to keep when pruning context */
    contextKeepLastMessages: number;

    // ── Effort-based step budget ────────────────────
    /** Max steps for quick-effort requests (greetings, factual) */
    effortStepsQuick: number;
    /** Max steps for moderate-effort requests (few tool calls) */
    effortStepsModerate: number;
    /** Max retries passed to ToolLoopAgent */
    agentMaxRetries: number;

    // ── Tool result compression ─────────────────────
    /** Char threshold above which tool results get compressed */
    compressThreshold: number;
    /** Max length of compressed summaries */
    compressMaxSummary: number;
    /** Step number after which compression kicks in */
    compressAfterStep: number;
    /** Max chars of raw tool output sent to the compression model */
    compressInputMaxChars: number;

    // ── Instant Classifier ──────────────────────────
    /** Max retry attempts for classifier/postflight generateObject calls */
    flightMaxRetries: number;
    /** Number of recent chat exchanges to feed the classifier */
    plannerChatHistoryLimit: number;
    /** Max chars of agent response sent to the postflight evaluator */
    postflightMaxResponseChars: number;

    // ── Tool RAG (dynamic tool loading) ─────────────
    /** When true, only core tools are loaded per step; others are discovered via search_available_tools.
     *  Saves ~8-11K tokens per request by not sending all tool definitions upfront. */
    dynamicToolLoading: boolean;
}

// ── SearXNG ────────────────────────────────────────────

export interface SearxngConfig {
    url: string;
}

// ── Full config ────────────────────────────────────────

export interface ForkscoutConfig {
    /** Default LLM provider */
    provider: ProviderType;
    /** Default model ID */
    model: string;
    /** Default base URL */
    baseURL: string;
    /** Sampling temperature */
    temperature: number;
    /** Max tokens per response */
    maxTokens: number;

    /**
     * Ordered list of fallback providers to try when the primary provider fails
     * with auth (401/403) or network errors. Each entry is a ProviderType string.
     * The system will try them in order until one succeeds.
     * Example: ["openrouter", "google", "anthropic"]
     */
    fallbackProviders: ProviderType[];

    /** Multi-model router tiers (resolved from active provider's preset) */
    router: RouterConfig;

    /** Per-provider router presets (raw from config file, kept for hot-swap) */
    routerPresets?: ProviderRouterPresets;

    /** Agent settings */
    agent: AgentSettings;

    /** SearXNG web search */
    searxng: SearxngConfig;

    // ── Secrets (resolved from .env, never in config file) ──
    secrets: {
        openrouterApiKey: string;
        openrouterApiUrl: string;
        openaiApiKey: string;
        openaiApiUrl: string;
        anthropicApiKey: string;
        anthropicApiUrl: string;
        googleApiKey: string;
        googleApiUrl: string;
        githubApiKey: string;
        githubApiUrl: string;
        copilotBridgeUrl: string;
        openApiCompatibleApiKey: string;
        openApiCompatibleApiUrl: string;
        adminSecret: string;
        telegramBotToken: string;
    };
}

// ── Defaults ───────────────────────────────────────────

/** Built-in per-provider router presets — used when config file has per-provider format */
export const PROVIDER_ROUTER_DEFAULTS: Record<string, RouterConfig> = {
    openrouter: {
        fast: { model: 'google/gemini-2.0-flash-001', provider: 'openrouter' },
        balanced: { model: 'x-ai/grok-4.1-fast', provider: 'openrouter' },
        powerful: { model: 'anthropic/claude-sonnet-4', provider: 'openrouter' },
    },
    google: {
        fast: { model: 'gemini-2.0-flash-lite', provider: 'google' },
        balanced: { model: 'gemini-2.5-flash', provider: 'google' },
        powerful: { model: 'gemini-2.5-pro', provider: 'google' },
    },
    anthropic: {
        fast: { model: 'claude-haiku-3.5', provider: 'anthropic' },
        balanced: { model: 'claude-sonnet-4', provider: 'anthropic' },
        powerful: { model: 'claude-opus-4', provider: 'anthropic' },
    },
    openai: {
        fast: { model: 'gpt-4.1-mini', provider: 'openai' },
        balanced: { model: 'gpt-4.1', provider: 'openai' },
        powerful: { model: 'o3', provider: 'openai' },
    },
    github: {
        fast: { model: 'gpt-4o-mini', provider: 'github' },
        balanced: { model: 'gpt-4o', provider: 'github' },
        powerful: { model: 'o1', provider: 'github' },
    },
    'copilot-bridge': {
        fast: { model: 'gpt-4o-mini', provider: 'copilot-bridge' },
        balanced: { model: 'claude-sonnet-4.6', provider: 'copilot-bridge' },
        powerful: { model: 'claude-opus-4.6', provider: 'copilot-bridge' },
    },
};

export const DEFAULTS: Omit<ForkscoutConfig, 'secrets'> = {
    provider: 'openrouter',
    model: 'x-ai/grok-4.1-fast',
    baseURL: 'https://openrouter.ai/api/v1',
    temperature: 0.7,
    maxTokens: 2000,
    fallbackProviders: [],
    router: PROVIDER_ROUTER_DEFAULTS.openrouter,
    agent: {
        maxIterations: 10,
        maxSteps: 60,
        autoRegisterTools: true,
        port: 3210,
        owner: 'Admin',
        appName: 'Forkscout Agent',
        appUrl: 'https://github.com/martianacademy/forkscout',
        forkscoutMemoryMcpUrl: undefined,
        mcpServers: {
            'sequential-thinking': {
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
            },
            deepwiki: {
                url: 'https://mcp.deepwiki.com/mcp',
            },
        },
        subAgent: {
            maxSteps: 20,
            timeoutMs: 300_000,
            maxParallel: 10,
            tier: 'fast' as const,
            retryAttempts: 2,
            retryDelayMs: 500,
            outputMaxLength: 2000,
            temperature: 0.5,
            batchTimeoutMs: 0,
        },
        server: {
            rateLimitLocal: 300,
            rateLimitRemote: 30,
            rateLimitWindowMs: 60_000,
            maxBodyBytes: 1_048_576,
        },
        telegram: {
            maxInbox: 200,
            maxHistory: 20,
        },
        failureEscalationThreshold: 3,
        browserIdleMs: 60_000,
        activityLogMaxBytes: 5 * 1024 * 1024,
        maxToolRetries: 6,
        contextPruneAfterStep: 4,
        contextKeepLastMessages: 4,
        effortStepsQuick: 10,
        effortStepsModerate: 15,
        agentMaxRetries: 3,
        compressThreshold: 1000,
        compressMaxSummary: 500,
        compressAfterStep: 0,
        compressInputMaxChars: 6000,
        flightMaxRetries: 1,
        plannerChatHistoryLimit: 3,
        postflightMaxResponseChars: 2000,
        dynamicToolLoading: false,
    },
    searxng: { url: 'http://localhost:8888' },
};

// ── Provider → base URL mapping ────────────────────────

export const PROVIDER_URLS: Record<string, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    github: 'https://models.inference.ai.azure.com',
    'copilot-bridge': 'http://localhost:4000/v1',
    ollama: 'http://localhost:11434/v1',
};
