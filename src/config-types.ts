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
