// src/config-types.ts — All config interface types (extracted from config.ts for 200-line limit)

export type {
    ChannelDefaults, ChannelsConfig,
    TelegramChannelConfig, TerminalChannelConfig, SelfChannelConfig,
    WhatsAppChannelConfig, DiscordChannelConfig, SlackChannelConfig,
    EmailChannelConfig, MatrixChannelConfig, WebchatChannelConfig,
    TeamsChannelConfig, GoogleChatChannelConfig, LineChannelConfig,
    ViberChannelConfig, MessengerChannelConfig, InstagramChannelConfig,
    TwitterChannelConfig, RedditChannelConfig, YoutubeChannelConfig,
    SmsChannelConfig, VoiceChannelConfig,
} from "@/channel-types.ts";
import type { ChannelsConfig } from "@/channel-types.ts";

export interface ModelTiers {
    fast: string;
    balanced: string;
    powerful: string;
    vision?: string;
    summarizer?: string;
}

/** Provider config: model tiers + optional custom-endpoint meta-fields.
 *  Known providers (openrouter, openai, etc.) ignore the _ fields.
 *  Custom providers MUST set _type to use the factory pattern. */
export interface ProviderConfig extends ModelTiers {
    /** Factory type — currently only "openai_compatible" */
    _type?: "openai_compatible";
    /** API base URL, e.g. "http://localhost:11434/v1" */
    _baseURL?: string;
    /** API key — prefix with $ to read from env, e.g. "$MY_KEY" */
    _apiKey?: string;
}

export type ModelTier = "fast" | "balanced" | "powerful";

export interface LLMConfig {
    provider: string;
    tier: ModelTier;
    maxTokens: number;
    maxSteps: number;
    /** Abort if the same tool is called this many consecutive steps. Prevents infinite retry loops. Default: 3 */
    loopGuardMaxConsecutive?: number;
    reasoningTag?: string;
    llmSummarizeMaxTokens?: number;
    toolResultAutoCompressWords?: number;
    /** When true, runs a structured planning step before each agent run using the fast model tier */
    planFirst?: boolean;
    providers: { [provider: string]: ProviderConfig };
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
    ownerOnlyTools?: string[];
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
    channels: ChannelsConfig;
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
    toolDefaults?: ToolDefaults;
    skills?: { dirs?: string[] };
    n8n?: N8nConfig;
    embeddings?: {
        enabled: boolean; provider: "openrouter" | "google"; model: string;
        topK: number; chunkMaxTokens: number;
    };
    imageGeneration?: {
        enabled: boolean;
        provider: string;
        model: string;
        defaultSize: string;
        defaultQuality: "standard" | "hd";
        defaultStyle?: "natural" | "vivid";
    };
    videoGeneration?: {
        enabled: boolean;
        provider: string;
        model: string;
        defaultDuration?: number;
        defaultAspectRatio?: string;
    };
    memory?: MemoryConfig;
}

export interface MemoryConfig {
    enabled: boolean;
}
