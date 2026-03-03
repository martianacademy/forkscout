// src/channel-types.ts — All per-channel config interfaces (extracted for 200-line limit)

import type { SelfJobConfig } from "@/config-types.ts";

/** Common defaults inherited by all channels unless overridden */
export interface ChannelDefaults {
    historyTokenBudget?: number;
    rateLimitPerMinute?: number;
    maxInputLength?: number;
}

export interface TelegramChannelConfig {
    pollingTimeout: number;
    historyTokenBudget: number;
    ownerUserIds: number[];
    allowedUserIds: number[];
    rateLimitPerMinute: number;
    maxInputLength: number;
    maxToolResultTokens: number;
    maxSentencesPerToolResult: number;
}

export interface TerminalChannelConfig { historyTokenBudget: number }

export interface SelfChannelConfig {
    historyTokenBudget: number; httpPort: number; jobs?: SelfJobConfig[];
}

export interface WhatsAppChannelConfig {
    sessionDir: string;
    historyTokenBudget: number;
    ownerJids: string[];
    allowedJids: string[];
    rateLimitPerMinute: number;
    maxInputLength: number;
}

export interface DiscordChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    allowedChannelIds?: string[];
    rateLimitPerMinute?: number;
}

export interface SlackChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    allowedChannelIds?: string[];
    rateLimitPerMinute?: number;
}

export interface EmailChannelConfig {
    historyTokenBudget?: number;
    ownerEmails?: string[];
    allowedEmails?: string[];
    pollIntervalMs?: number;
}

export interface MatrixChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    allowedRoomIds?: string[];
    rateLimitPerMinute?: number;
}

export interface WebchatChannelConfig {
    historyTokenBudget?: number;
    ownerToken?: string;
    allowPublic?: boolean;
}

export interface TeamsChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    rateLimitPerMinute?: number;
}

export interface GoogleChatChannelConfig {
    historyTokenBudget?: number;
    ownerEmails?: string[];
    allowedEmails?: string[];
    allowedSpaces?: string[];
    rateLimitPerMinute?: number;
}

export interface LineChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    rateLimitPerMinute?: number;
}

export interface ViberChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    rateLimitPerMinute?: number;
}

export interface MessengerChannelConfig {
    historyTokenBudget?: number;
    ownerPsids?: string[];
    allowedPsids?: string[];
    rateLimitPerMinute?: number;
}

export interface InstagramChannelConfig {
    historyTokenBudget?: number;
    ownerIgIds?: string[];
    allowedIgIds?: string[];
    rateLimitPerMinute?: number;
}

export interface TwitterChannelConfig {
    historyTokenBudget?: number;
    ownerIds?: string[];
    allowedUserIds?: string[];
    pollIntervalMs?: number;
    rateLimitPerMinute?: number;
}

export interface RedditChannelConfig {
    historyTokenBudget?: number;
    ownerUsernames?: string[];
    pollIntervalMs?: number;
    rateLimitPerMinute?: number;
}

export interface YoutubeChannelConfig {
    historyTokenBudget?: number;
    ownerChannelIds?: string[];
    pollIntervalMs?: number;
    rateLimitPerMinute?: number;
}

export interface SmsChannelConfig {
    historyTokenBudget?: number;
    ownerPhones?: string[];
    allowedPhones?: string[];
    rateLimitPerMinute?: number;
}

export interface VoiceChannelConfig {
    historyTokenBudget?: number;
    ownerPhones?: string[];
    allowedPhones?: string[];
    rateLimitPerMinute?: number;
}

/** Top-level channels config — defaults + per-channel overrides */
export interface ChannelsConfig {
    defaults: ChannelDefaults;
    telegram: TelegramChannelConfig;
    terminal: TerminalChannelConfig;
    self?: SelfChannelConfig;
    whatsapp?: WhatsAppChannelConfig;
    discord?: DiscordChannelConfig;
    slack?: SlackChannelConfig;
    email?: EmailChannelConfig;
    matrix?: MatrixChannelConfig;
    webchat?: WebchatChannelConfig;
    teams?: TeamsChannelConfig;
    googleChat?: GoogleChatChannelConfig;
    line?: LineChannelConfig;
    viber?: ViberChannelConfig;
    messenger?: MessengerChannelConfig;
    instagram?: InstagramChannelConfig;
    twitter?: TwitterChannelConfig;
    reddit?: RedditChannelConfig;
    youtube?: YoutubeChannelConfig;
    sms?: SmsChannelConfig;
    voice?: VoiceChannelConfig;
}
