/**
 * Config types — shared type definitions, defaults, and constants.
 *
 * All config-related interfaces live here so they can be imported
 * independently without pulling in the loader or builder logic.
 *
 * @module config/types
 */

// ── Provider types ─────────────────────────────────────

export type ProviderType = 'openrouter' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'openai-compatible';

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

// ── Budget ─────────────────────────────────────────────

export interface BudgetConfig {
    dailyUSD: number;
    monthlyUSD: number;
    warningPct: number;
}

// ── MCP servers ────────────────────────────────────────

export interface McpServerEntry {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
}

// ── Agent settings ─────────────────────────────────────

export interface AgentSettings {
    maxIterations: number;
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

    /** Multi-model router tiers (resolved from active provider's preset) */
    router: RouterConfig;

    /** Per-provider router presets (raw from config file, kept for hot-swap) */
    routerPresets?: ProviderRouterPresets;

    /** Budget limits */
    budget: BudgetConfig;

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
};

export const DEFAULTS: Omit<ForkscoutConfig, 'secrets'> = {
    provider: 'openrouter',
    model: 'x-ai/grok-4.1-fast',
    baseURL: 'https://openrouter.ai/api/v1',
    temperature: 0.7,
    maxTokens: 2000,
    router: PROVIDER_ROUTER_DEFAULTS.openrouter,
    budget: { dailyUSD: 5, monthlyUSD: 50, warningPct: 80 },
    agent: {
        maxIterations: 10,
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
    },
    searxng: { url: 'http://localhost:8888' },
};

// ── Provider → base URL mapping ────────────────────────

export const PROVIDER_URLS: Record<string, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    ollama: 'http://localhost:11434/v1',
};
