// src/config-types.ts — All config interface types (extracted from config.ts for 200-line limit)

export interface ModelTiers {
    fast: string;
    balanced: string;
    powerful: string;
    vision?: string;
    summarizer?: string;
    browser?: string;
    transcriber?: string;
    tts?: string;
}

export type ModelTier = "fast" | "balanced" | "powerful";

export interface LLMConfig {
    provider: string;
    tier: ModelTier;
    maxTokens: number;
    maxSteps: number;
    reasoningTag?: string;
    llmSummarizeMaxTokens?: number;
    toolResultAutoCompressWords?: number;
    providers: { [provider: string]: ModelTiers };
}

export interface BrowserAgentConfig {
    maxSteps: number;
    maxTokens: number;
    screenshotPrompt?: string;
}

export interface AgentConfig {
    name: string;
    description?: string;
    github: string;
    systemPromptExtra?: string;
}

export interface SelfJobConfig {
    name: string;
    schedule: string;
    message: string;
    run_once?: boolean;
    telegram?: { chatIds: number[] };
}

export interface ToolDefaults { [toolName: string]: Record<string, unknown> }
export interface N8nConfig { baseUrl: string; workflows?: string[] }

export interface AppConfig {
    telegram: {
        pollingTimeout: number;
        historyTokenBudget: number;
        ownerUserIds: number[];
        allowedUserIds: number[];
        rateLimitPerMinute: number;
        maxInputLength: number;
        ownerOnlyTools: string[];
        maxToolResultTokens: number;
        maxSentencesPerToolResult: number;
    };
    terminal: { historyTokenBudget: number };
    self?: { historyTokenBudget: number; httpPort: number; jobs?: SelfJobConfig[] };
    whatsapp?: {
        sessionDir: string;
        historyTokenBudget: number;
        ownerJids: string[];
        allowedJids: string[];
        rateLimitPerMinute: number;
        maxInputLength: number;
        ownerOnlyTools: string[];
    };
    discord?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        allowedChannelIds?: string[];
        rateLimitPerMinute?: number;
    };
    slack?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        allowedChannelIds?: string[];
        rateLimitPerMinute?: number;
    };
    email?: {
        historyTokenBudget?: number;
        ownerEmails?: string[];
        allowedEmails?: string[];
        pollIntervalMs?: number;
    };
    matrix?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        allowedRoomIds?: string[];
        rateLimitPerMinute?: number;
    };
    webchat?: {
        historyTokenBudget?: number;
        ownerToken?: string;
        allowPublic?: boolean;
    };
    teams?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        rateLimitPerMinute?: number;
    };
    googleChat?: {
        historyTokenBudget?: number;
        ownerEmails?: string[];
        allowedEmails?: string[];
        allowedSpaces?: string[];
        rateLimitPerMinute?: number;
    };
    line?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        rateLimitPerMinute?: number;
    };
    viber?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        rateLimitPerMinute?: number;
    };
    messenger?: {
        historyTokenBudget?: number;
        ownerPsids?: string[];
        allowedPsids?: string[];
        rateLimitPerMinute?: number;
    };
    instagram?: {
        historyTokenBudget?: number;
        ownerIgIds?: string[];
        allowedIgIds?: string[];
        rateLimitPerMinute?: number;
    };
    twitter?: {
        historyTokenBudget?: number;
        ownerIds?: string[];
        allowedUserIds?: string[];
        pollIntervalMs?: number;
        rateLimitPerMinute?: number;
    };
    reddit?: {
        historyTokenBudget?: number;
        ownerUsernames?: string[];
        pollIntervalMs?: number;
        rateLimitPerMinute?: number;
    };
    youtube?: {
        historyTokenBudget?: number;
        ownerChannelIds?: string[];
        pollIntervalMs?: number;
        rateLimitPerMinute?: number;
    };
    sms?: {
        historyTokenBudget?: number;
        ownerPhones?: string[];
        allowedPhones?: string[];
        rateLimitPerMinute?: number;
    };
    voice?: {
        historyTokenBudget?: number;
        ownerPhones?: string[];
        allowedPhones?: string[];
        rateLimitPerMinute?: number;
    };
    llm: LLMConfig;
    agent: AgentConfig;
    browserAgent: BrowserAgentConfig;
    browser: {
        headless: boolean; profileDir: string; screenshotQuality: number;
        chromePath?: string; extraArgs?: string[];
        viewport?: { width: number; height: number };
        userAgent?: string; locale?: string; timezone?: string;
        context?: Record<string, unknown>;
    };
    speech?: {
        enabled: boolean;
        ttsProvider: "elevenlabs" | "openai" | "google" | "openrouter";
        ttsModel: string; ttsVoice: string;
        sttProvider: "elevenlabs" | "openai" | "google" | "openrouter";
        sttModel: string; language: string;
    };
    toolDefaults?: ToolDefaults;
    skills?: { dirs?: string[] };
    n8n?: N8nConfig;
    embeddings?: {
        enabled: boolean; provider: "openrouter" | "google"; model: string;
        topK: number; chunkMaxTokens: number;
    };
}
