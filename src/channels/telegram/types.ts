/**
 * Telegram API types (minimal subset) and bridge configuration.
 */

import type { UIMessage } from 'ai';

// ── Telegram API types ───────────────────────────────

export interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

export interface TelegramChat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
}

export interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}

export interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    chat: TelegramChat;
    date: number;
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    reply_to_message?: TelegramMessage;
    // Document / file attachments
    document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
    video?: { file_id: string; file_unique_id: string; width: number; height: number; duration: number; file_name?: string; mime_type?: string; file_size?: number };
    audio?: { file_id: string; file_unique_id: string; duration: number; performer?: string; title?: string; file_name?: string; mime_type?: string; file_size?: number };
    voice?: { file_id: string; file_unique_id: string; duration: number; mime_type?: string; file_size?: number };
    video_note?: { file_id: string; file_unique_id: string; length: number; duration: number; file_size?: number };
    sticker?: { file_id: string; file_unique_id: string; width: number; height: number; is_animated: boolean; emoji?: string; set_name?: string };
    // Location & contact
    location?: { latitude: number; longitude: number; horizontal_accuracy?: number };
    contact?: { phone_number: string; first_name: string; last_name?: string; user_id?: number };
    // Forwarded message info
    forward_from?: TelegramUser;
    forward_from_chat?: TelegramChat;
    forward_date?: number;
    forward_sender_name?: string;
    // Message entities (links, mentions, hashtags, etc.)
    entities?: { type: string; offset: number; length: number; url?: string; user?: TelegramUser }[];
    caption_entities?: { type: string; offset: number; length: number; url?: string; user?: TelegramUser }[];
    // Poll
    poll?: { id: string; question: string; options: { text: string; voter_count: number }[]; is_anonymous: boolean; type: string; total_voter_count: number };
    // Edit tracking
    edit_date?: number;
    // Catch-all for future Telegram API additions
    [key: string]: any;
}

export interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
}

export interface TelegramBotInfo {
    id: number;
    is_bot: boolean;
    first_name: string;
    username: string;
}

// ── Persistent state types ───────────────────────────

/** A queued message from a user (stored to disk so nothing is lost across restarts) */
export interface InboxMessage {
    messageId: number;
    chatId: number;
    userId: string;
    displayName: string;
    username?: string;
    text: string;
    date: number;
    responded: boolean;
}

export interface TelegramState {
    offset: number;
    lastStartedAt: number;
    lastStoppedAt: number;
    inbox: InboxMessage[];
    version: number;
}

// ── Bridge config ────────────────────────────────────

export interface TelegramBridgeConfig {
    /** Telegram Bot API token */
    token: string;
    /** Long-polling timeout in seconds (default: 30) */
    pollTimeout?: number;
    /** Max message length before splitting (default: 4096 — Telegram limit) */
    maxMessageLength?: number;
}

// ── Constants ────────────────────────────────────────

// Re-export from shared location — kept here for backward compatibility
export { describeToolCall } from '../../utils/describe-tool-call';

// ── Chat history type ────────────────────────────────

export type ChatHistories = Map<number, UIMessage[]>;

// ── Helpers ──────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Human-readable time ago string */
export function humanTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds} second(s) ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute(s) ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour(s) ago`;
    const days = Math.floor(hours / 24);
    return `${days} day(s) ago`;
}
