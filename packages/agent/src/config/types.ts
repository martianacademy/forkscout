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
    /** Built-in MCP servers to connect on startup */
    mcpServers: Record<string, McpServerEntry>;
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

    /** Multi-model router tiers */
    router: RouterConfig;

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

export const DEFAULTS: Omit<ForkscoutConfig, 'secrets'> = {
    provider: 'openrouter',
    model: 'x-ai/grok-4.1-fast',
    baseURL: 'https://openrouter.ai/api/v1',
    temperature: 0.7,
    maxTokens: 2000,
    router: {
        fast: { model: 'google/gemini-2.0-flash-001', provider: 'openrouter' },
        balanced: { model: 'x-ai/grok-4.1-fast', provider: 'openrouter' },
        powerful: { model: 'anthropic/claude-sonnet-4', provider: 'openrouter' },
    },
    budget: { dailyUSD: 5, monthlyUSD: 50, warningPct: 80 },
    agent: {
        maxIterations: 10,
        autoRegisterTools: true,
        port: 3210,
        owner: 'Admin',
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
