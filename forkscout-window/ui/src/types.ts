// types.ts — All shared types for Forkscout Window (standalone Chrome extension)

// ── Providers ────────────────────────────────────────────────────────────────

export type ProviderId =
    | "openai" | "anthropic" | "google" | "groq" | "openrouter"
    | "mistral" | "deepseek" | "xai" | "ollama" | "lmstudio" | "custom";

export interface ModelOption {
    id: string;
    name: string;
    contextLength: number;
    vision?: boolean;
}

export interface ProviderDef {
    id: ProviderId;
    name: string;
    baseURL: string;
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    requiresKey: boolean;
    format: "openai" | "anthropic" | "google";
    models: ModelOption[];
    defaultModel: string;
}

// ── Messages / Sessions ──────────────────────────────────────────────────────

export interface Message {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    error?: boolean;
}

export interface ChatSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Message[];
    provider: ProviderId;
    model: string;
    systemPrompt: string;
}

// ── Memory ───────────────────────────────────────────────────────────────────

export interface Memory {
    id: string;
    content: string;
    createdAt: number;
    source?: "user" | "auto";
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
    provider: ProviderId;
    model: string;
    apiKeys: Record<string, string>;
    customBaseURL: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    streamingEnabled: boolean;
    injectPageContext: boolean;
    injectMemories: boolean;
    maxMemoriesToInject: number;
    agentUrl: string;
    agentToken: string;
    mcpBridgeEnabled: boolean;
}

// ── Page context ─────────────────────────────────────────────────────────────

export interface PageContext {
    url: string;
    title: string;
    selectedText?: string;
}

// ── Storage keys ─────────────────────────────────────────────────────────────

export const SK = {
    SETTINGS: "fw_settings",
    SESSIONS: "fw_sessions",
    MEMORIES: "fw_memories",
    ACTIVE_SESSION: "fw_active_session",
} as const;
