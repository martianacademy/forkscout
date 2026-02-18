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

/** Generate a human-readable description of a tool call from its name and arguments. */
export function describeToolCall(toolName: string, args: Record<string, any> = {}): string {
    const shorten = (s: string, max = 60) => s.length > max ? s.slice(0, max) + '…' : s;
    const file = (p: string) => p.split('/').slice(-2).join('/'); // show last 2 path segments

    switch (toolName) {
        // ── Shell & system ──
        case 'run_command':
            return `⚙️ Running: \`${shorten(args.command || 'command', 80)}\``;
        case 'self_rebuild':
            return `🔨 Rebuilding myself — ${shorten(args.reason || 'updating code')}`;

        // ── Files ──
        case 'read_file':
            return `📄 Reading ${file(args.path || 'file')}`;
        case 'write_file':
            return `📝 Writing to ${file(args.path || 'file')}`;
        case 'append_file':
            return `📝 Appending to ${file(args.path || 'file')}`;
        case 'delete_file':
            return `🗑 Deleting ${file(args.path || 'file')}`;
        case 'list_directory':
            return `📂 Listing ${file(args.path || '.')}`;
        case 'safe_self_edit':
            return `🛠 Editing ${file(args.path || 'file')} — ${shorten(args.reason || 'update')}`;

        // ── Web ──
        case 'web_search':
            return `🔍 Searching: "${shorten(args.query || 'query')}"`;
        case 'browse_web':
            return `🌐 Browsing ${shorten(args.url || 'page')}`;
        case 'browser_screenshot':
            return `📸 Screenshotting ${shorten(args.url || 'page')}`;
        case 'http_request':
            return `🌐 ${(args.method || 'GET').toUpperCase()} ${shorten(args.url || 'endpoint')}`;

        // ── Scheduler ──
        case 'schedule_job':
            return `⏰ Scheduling "${args.name || 'job'}" — ${shorten(args.schedule || 'cron')}`;
        case 'list_jobs':
            return '⏰ Listing all scheduled jobs';
        case 'remove_job':
            return `⏰ Removing job: ${args.jobId || 'unknown'}`;
        case 'pause_job':
            return `⏸ Pausing job: ${args.jobId || 'unknown'}`;
        case 'resume_job':
            return `▶️ Resuming job: ${args.jobId || 'unknown'}`;

        // ── Memory & knowledge ──
        case 'save_knowledge':
            return `🧠 Saving: "${shorten(args.fact || 'fact')}"`;
        case 'search_knowledge':
            return `🧠 Searching memory: "${shorten(args.query || 'query')}"`;
        case 'memory_store':
            return `🧠 Storing in memory`;
        case 'memory_recall':
            return `🧠 Recalling from memory`;
        case 'add_entity':
            return `📚 Adding ${args.type || 'entity'}: ${args.name || '?'}`;
        case 'add_relation':
            return `📚 Linking: ${args.from || '?'} → ${args.to || '?'} (${args.type || 'related'})`;
        case 'search_graph':
            return `📚 Searching knowledge graph: "${shorten(args.query || 'query')}"`;
        case 'graph_stats':
            return '📚 Checking knowledge graph stats';
        case 'self_reflect':
            return `🪞 Reflecting: "${shorten(args.observation || 'thought')}"`;
        case 'self_inspect':
            return '🔎 Inspecting my own state';
        case 'clear_memory':
            return `🧹 Clearing memory — ${shorten(args.reason || 'cleanup')}`;

        // ── Survival & system ──
        case 'check_vitals':
            return '💓 Checking system vitals';
        case 'backup_memory':
            return `💾 Backing up memory${args.reason ? ' — ' + shorten(args.reason) : ''}`;
        case 'system_status':
            return '📊 Checking system status';
        case 'check_budget':
            return '💰 Checking budget usage';
        case 'set_model_tier':
            return `🎛 Setting ${args.tier || 'tier'} model to ${args.modelId || '?'}`;
        case 'set_budget_limit':
            return `💰 Updating budget limits`;

        // ── Telegram ──
        case 'send_telegram_message':
            return `💬 Sending message${args.lookup ? ' to ' + args.lookup : ''}`;
        case 'send_telegram_photo':
            return `📷 Sending photo: ${file(args.filePath || 'image')}`;
        case 'send_telegram_file':
            return `📎 Sending file: ${file(args.filePath || 'file')}`;

        // ── Channel auth ──
        case 'grant_channel_access':
            return `🔑 Granting ${args.role || 'access'} to user ${args.userId || '?'} on ${args.channel || 'channel'}`;
        case 'revoke_channel_access':
            return `🔑 Revoking access for user ${args.userId || '?'}`;
        case 'list_channel_users':
            return `🔑 Listing users${args.channel ? ' on ' + args.channel : ''}`;

        // ── MCP ──
        case 'add_mcp_server':
            return `🔌 Adding MCP server: ${args.name || '?'}`;
        case 'remove_mcp_server':
            return `🔌 Removing MCP server: ${args.name || '?'}`;
        case 'list_mcp_servers':
            return '🔌 Listing MCP servers';

        // ── Other ──
        case 'date_time':
        case 'get_current_date':
            return '🕐 Checking date/time';
        case 'list_secrets':
            return '🔑 Checking available secrets';
        case 'generate_presentation':
            return `📊 Generating presentation: "${shorten(args.title || 'slides')}"`;
        case 'view_activity_log':
            return `📋 Viewing activity log (last ${args.count || '?'}${args.type ? ', ' + args.type : ''})`;

        default:
            return `⚙️ ${toolName}`;
    }
}

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
