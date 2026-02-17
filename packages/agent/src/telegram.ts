/**
 * Telegram Bridge — connects Forkscout agent to a Telegram Bot via long polling.
 *
 * Uses the Telegram Bot API (no external deps — just fetch):
 *   - getUpdates (long polling) to receive messages
 *   - sendMessage / sendChatAction to respond
 *
 * Integrates with:
 *   - Agent instance (model, tools, memory, system prompt)
 *   - ChannelAuthStore (session tracking + admin grants)
 *
 * Env: TELEGRAM_BOT_TOKEN
 */

import { stepCountIs, type UIMessage } from 'ai';
import { generateTextWithRetry } from './llm/retry';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { resolve as resolvePath, basename } from 'path';
import type { Agent, ChatContext } from './agent';
import { AGENT_ROOT } from './paths';

// ── Telegram API types (minimal subset) ──────────────

interface TelegramUser {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
}

interface TelegramChat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
}

interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}

interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    chat: TelegramChat;
    date: number;
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    reply_to_message?: TelegramMessage;
}

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
    edited_message?: TelegramMessage;
}

interface TelegramBotInfo {
    id: number;
    is_bot: boolean;
    first_name: string;
    username: string;
}

// ── Persistent state ─────────────────────────────────

/** A queued message from a user (stored to disk so nothing is lost across restarts) */
interface InboxMessage {
    /** Telegram message ID */
    messageId: number;
    /** Chat ID (for replying) */
    chatId: number;
    /** User ID */
    userId: string;
    /** Display name */
    displayName: string;
    /** Username (without @) */
    username?: string;
    /** Message text */
    text: string;
    /** Unix timestamp from Telegram */
    date: number;
    /** Whether this message has been responded to */
    responded: boolean;
}

interface TelegramState {
    /** Last confirmed getUpdates offset */
    offset: number;
    /** Unix timestamp of last bot startup */
    lastStartedAt: number;
    /** Unix timestamp of last clean shutdown */
    lastStoppedAt: number;
    /** Queued messages from guests (and missed admin messages) */
    inbox: InboxMessage[];
    version: number;
}

// ── Bridge ───────────────────────────────────────────

export interface TelegramBridgeConfig {
    /** Telegram Bot API token */
    token: string;
    /** Long-polling timeout in seconds (default: 30) */
    pollTimeout?: number;
    /** Max message length before splitting (default: 4096 — Telegram limit) */
    maxMessageLength?: number;
}

export class TelegramBridge {
    private token: string;
    private baseUrl: string;
    private agent: Agent;
    private pollTimeout: number;
    private maxMsgLen: number;
    private offset = 0;
    private running = false;
    private botInfo: TelegramBotInfo | null = null;
    private startedAt = 0;  // unix timestamp of this boot

    // Persistent state (offset + inbox)
    private statePath: string;
    private inbox: InboxMessage[] = [];
    private stateDirty = false;

    // Track per-chat message history for multi-turn context
    private chatHistories: Map<number, UIMessage[]> = new Map();
    private readonly MAX_HISTORY = 20;  // keep last N messages per chat
    private readonly MAX_INBOX = 200;   // cap inbox size

    // Human-readable labels for tool calls (shown as progress updates)
    private static readonly TOOL_LABELS: Record<string, string> = {
        web_search: '🔍 Searching the web…',
        browse_web: '🌐 Browsing a page…',
        screenshot: '📸 Taking a screenshot…',
        read_file: '📄 Reading a file…',
        write_file: '📝 Writing a file…',
        safe_self_edit: '🛠 Editing source code…',
        run_command: '⚙️ Running a command…',
        memory_store: '🧠 Saving to memory…',
        memory_recall: '🧠 Recalling from memory…',
        knowledge_query: '📚 Searching knowledge graph…',
        knowledge_store: '📚 Storing knowledge…',
        schedule_task: '⏰ Scheduling a task…',
        list_scheduled: '⏰ Checking scheduled tasks…',
        list_files: '📂 Listing files…',
        delete_file: '🗑 Deleting a file…',
        date_time: '🕐 Checking date/time…',
        grant_channel_access: '🔑 Updating access…',
        send_telegram_message: '💬 Sending a message…',
        send_telegram_photo: '📷 Sending a photo…',
        send_telegram_file: '📎 Sending a file…',
        browser_screenshot: '📸 Taking a screenshot…',
        list_secrets: '🔑 Checking available secrets…',
        http_request: '🌐 Making API request…',
    };

    constructor(agent: Agent, config: TelegramBridgeConfig) {
        this.token = config.token;
        this.baseUrl = `https://api.telegram.org/bot${this.token}`;
        this.agent = agent;
        this.pollTimeout = config.pollTimeout ?? 30;
        this.maxMsgLen = config.maxMessageLength ?? 4096;

        const dataDir = resolvePath(AGENT_ROOT, '.forkscout');
        this.statePath = resolvePath(dataDir, 'telegram-state.json');
    }

    // ── Persistent state management ───────────────────

    /** Load state from disk (offset, inbox) */
    private async loadState(): Promise<void> {
        try {
            const raw = await readFile(this.statePath, 'utf-8');
            const state: TelegramState = JSON.parse(raw);
            this.offset = state.offset || 0;
            this.inbox = state.inbox || [];
            console.log(`[Telegram]: Loaded state — offset: ${this.offset}, inbox: ${this.inbox.length} message(s), last stopped: ${state.lastStoppedAt ? new Date(state.lastStoppedAt * 1000).toISOString() : 'never'}`);
        } catch {
            // First run or corrupted — start fresh
            this.offset = 0;
            this.inbox = [];
        }
    }

    /** Save state to disk */
    private async saveState(): Promise<void> {
        if (!this.stateDirty) return;
        const dir = resolvePath(this.statePath, '..');
        await mkdir(dir, { recursive: true });
        const state: TelegramState = {
            offset: this.offset,
            lastStartedAt: this.startedAt,
            lastStoppedAt: 0,
            inbox: this.inbox.slice(-this.MAX_INBOX),  // cap size
            version: 1,
        };
        await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
        this.stateDirty = false;
    }

    /** Save shutdown timestamp */
    private async saveShutdownState(): Promise<void> {
        try {
            const raw = await readFile(this.statePath, 'utf-8');
            const state: TelegramState = JSON.parse(raw);
            state.lastStoppedAt = Math.floor(Date.now() / 1000);
            state.offset = this.offset;
            state.inbox = this.inbox.slice(-this.MAX_INBOX);
            await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
        } catch {
            // Best effort
        }
    }

    /** Add a message to the persistent inbox */
    private async addToInbox(msg: TelegramMessage, responded: boolean): Promise<void> {
        const user = msg.from!;
        this.inbox.push({
            messageId: msg.message_id,
            chatId: msg.chat.id,
            userId: String(user.id),
            displayName: [user.first_name, user.last_name].filter(Boolean).join(' '),
            username: user.username,
            text: msg.text || '',
            date: msg.date,
            responded,
        });
        // Trim old messages
        if (this.inbox.length > this.MAX_INBOX) {
            this.inbox = this.inbox.slice(-this.MAX_INBOX);
        }
        this.stateDirty = true;
        await this.saveState();
    }

    /** Get unresponded inbox messages for a specific user */
    getUnrespondedMessages(userId?: string): InboxMessage[] {
        const msgs = this.inbox.filter(m => !m.responded);
        return userId ? msgs.filter(m => m.userId === userId) : msgs;
    }

    // ── Telegram API helpers ──────────────────────────

    private async api<T = any>(method: string, params?: Record<string, any>): Promise<T> {
        const url = `${this.baseUrl}/${method}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params || {}),
        });
        const data = await res.json() as any;
        if (!data.ok) {
            throw new Error(`Telegram API ${method}: ${data.description || 'Unknown error'} (${data.error_code})`);
        }
        return data.result as T;
    }

    /**
     * Download a file from Telegram by file_id → returns base64 string + media type.
     */
    private async downloadFile(fileId: string): Promise<{ base64: string; mediaType: string } | null> {
        try {
            const fileInfo = await this.api<{ file_id: string; file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
            if (!fileInfo.file_path) return null;

            const url = `https://api.telegram.org/file/bot${this.token}/${fileInfo.file_path}`;
            const res = await fetch(url);
            if (!res.ok) return null;

            const buffer = Buffer.from(await res.arrayBuffer());
            const base64 = buffer.toString('base64');

            // Determine media type from file extension
            const ext = fileInfo.file_path.split('.').pop()?.toLowerCase() || 'jpg';
            const mediaTypes: Record<string, string> = {
                jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
                gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
            };
            const mediaType = mediaTypes[ext] || 'image/jpeg';

            return { base64, mediaType };
        } catch (err) {
            console.error(`[Telegram]: Failed to download file ${fileId}:`, err);
            return null;
        }
    }

    /** Verify the bot token and get bot info */
    async getMe(): Promise<TelegramBotInfo> {
        return this.api<TelegramBotInfo>('getMe');
    }

    /** Send a text message (auto-splits if too long) */
    async sendMessage(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
        const chunks = this.splitMessage(text);
        for (const chunk of chunks) {
            await this.api('sendMessage', {
                chat_id: chatId,
                text: chunk,
                parse_mode: 'Markdown',
                ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            }).catch(async () => {
                // Markdown parse failed — retry as plain text
                await this.api('sendMessage', {
                    chat_id: chatId,
                    text: chunk,
                    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
                });
            });
        }
    }

    /** Send a photo from a local file path */
    async sendPhoto(chatId: number, filePath: string, caption?: string): Promise<void> {
        const url = `${this.baseUrl}/sendPhoto`;
        const fileData = await readFile(filePath);
        const fileName = basename(filePath);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('photo', new Blob([fileData]), fileName);
        if (caption) form.append('caption', caption);
        const res = await fetch(url, { method: 'POST', body: form });
        const data = await res.json() as any;
        if (!data.ok) {
            throw new Error(`Telegram API sendPhoto: ${data.description || 'Unknown error'} (${data.error_code})`);
        }
    }

    /** Send a document/file from a local file path */
    async sendDocument(chatId: number, filePath: string, caption?: string): Promise<void> {
        const url = `${this.baseUrl}/sendDocument`;
        const fileData = await readFile(filePath);
        const fileName = basename(filePath);
        const form = new FormData();
        form.append('chat_id', String(chatId));
        form.append('document', new Blob([fileData]), fileName);
        if (caption) form.append('caption', caption);
        const res = await fetch(url, { method: 'POST', body: form });
        const data = await res.json() as any;
        if (!data.ok) {
            throw new Error(`Telegram API sendDocument: ${data.description || 'Unknown error'} (${data.error_code})`);
        }
    }

    /** Show "typing..." indicator */
    async sendTyping(chatId: number): Promise<void> {
        await this.api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => { });
    }

    /** Split long messages at paragraph/newline boundaries */
    private splitMessage(text: string): string[] {
        if (text.length <= this.maxMsgLen) return [text];
        const chunks: string[] = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= this.maxMsgLen) {
                chunks.push(remaining);
                break;
            }
            // Find a good split point
            let splitAt = remaining.lastIndexOf('\n\n', this.maxMsgLen);
            if (splitAt < this.maxMsgLen * 0.3) splitAt = remaining.lastIndexOf('\n', this.maxMsgLen);
            if (splitAt < this.maxMsgLen * 0.3) splitAt = remaining.lastIndexOf('. ', this.maxMsgLen);
            if (splitAt < this.maxMsgLen * 0.3) splitAt = this.maxMsgLen;
            chunks.push(remaining.slice(0, splitAt).trimEnd());
            remaining = remaining.slice(splitAt).trimStart();
        }
        return chunks;
    }

    // ── Long polling loop ─────────────────────────────

    /** Start the long-polling loop */
    async start(): Promise<void> {
        // Verify token
        try {
            this.botInfo = await this.getMe();
            console.log(`\n📱 Telegram bridge connected: @${this.botInfo.username} (${this.botInfo.first_name})`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Telegram bridge failed to connect: ${msg}`);
            return;
        }

        // Load persisted state (offset + inbox)
        await this.loadState();
        this.startedAt = Math.floor(Date.now() / 1000);

        this.running = true;

        // Process any missed messages from Telegram's queue (up to 24h old)
        await this.processMissedMessages();

        this.poll();  // fire and forget — runs forever
    }

    /** Stop polling and save state */
    async stop(): Promise<void> {
        this.running = false;
        await this.saveShutdownState();
        console.log('📱 Telegram bridge stopped (state saved)');
    }

    /**
     * On startup, fetch any queued updates from Telegram.
     * These are messages sent while the bot was offline.
     * Admin messages get a "sorry I was offline" prefix response.
     */
    private async processMissedMessages(): Promise<void> {
        try {
            // Non-blocking fetch (timeout=0 means don't wait for new updates)
            const updates = await this.api<TelegramUpdate[]>('getUpdates', {
                offset: this.offset,
                timeout: 0,
                allowed_updates: ['message'],
            });

            if (updates.length === 0) return;

            console.log(`[Telegram]: Found ${updates.length} missed message(s) while offline — processing...`);

            for (const update of updates) {
                this.offset = update.update_id + 1;
                await this.handleUpdate(update, true).catch(err => {
                    console.error(`[Telegram]: Error handling missed update ${update.update_id}:`, err);
                });
            }

            // Persist the new offset
            this.stateDirty = true;
            await this.saveState();

            console.log(`[Telegram]: Finished processing missed messages`);
        } catch (err) {
            console.error(`[Telegram]: Error fetching missed messages:`, err instanceof Error ? err.message : err);
        }
    }

    /** Continuous long-polling loop */
    private async poll(): Promise<void> {
        while (this.running) {
            try {
                const updates = await this.api<TelegramUpdate[]>('getUpdates', {
                    offset: this.offset,
                    timeout: this.pollTimeout,
                    allowed_updates: ['message'],
                });

                for (const update of updates) {
                    this.offset = update.update_id + 1;
                    this.stateDirty = true;
                    await this.handleUpdate(update, false).catch(err => {
                        console.error(`[Telegram]: Error handling update ${update.update_id}:`, err);
                    });
                }

                // Persist offset after each batch
                if (this.stateDirty) await this.saveState();
            } catch (err) {
                // Network error — wait and retry
                if (this.running) {
                    console.error(`[Telegram]: Polling error — retrying in 5s:`, err instanceof Error ? err.message : err);
                    await sleep(5000);
                }
            }
        }
    }

    // ── Message handling ──────────────────────────────

    /**
     * Handle a single Telegram update.
     * @param update  The Telegram update
     * @param isMissed  True if this message was received while the bot was offline
     */
    private async handleUpdate(update: TelegramUpdate, isMissed: boolean): Promise<void> {
        const msg = update.message;
        if (!msg || msg.from?.is_bot) return;  // skip bot messages

        // Accept text messages and photo messages (with optional caption)
        const hasText = !!msg.text?.trim();
        const hasPhoto = !!(msg.photo && msg.photo.length > 0);
        if (!hasText && !hasPhoto) return;  // skip unsupported message types

        const chatId = msg.chat.id;
        const user = msg.from!;
        const userId = String(user.id);
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ');
        const text = (msg.text || msg.caption || '').trim();

        // Download photo if present (pick largest resolution)
        let imageData: { base64: string; mediaType: string } | null = null;
        if (hasPhoto) {
            const largest = msg.photo![msg.photo!.length - 1]; // Telegram sends sizes smallest→largest
            imageData = await this.downloadFile(largest.file_id);
            if (imageData) {
                console.log(`[Telegram]: Downloaded photo (${largest.width}x${largest.height})`);
            }
        }

        // Skip commands that start with / unless it's /start
        if (text.startsWith('/') && !text.startsWith('/start')) {
            await this.sendMessage(chatId, "I respond to regular messages, not commands. Just type what you need!");
            return;
        }

        // Handle /start
        if (text.startsWith('/start')) {
            await this.sendMessage(chatId, `Hey ${user.first_name}! 👋 I'm Forkscout. Just send me a message and I'll help out!`);
            return;
        }

        const who = user.username ? `@${user.username}` : displayName;
        const missedTag = isMissed ? ' [MISSED]' : '';
        console.log(`\n[telegram/${who} (${userId})${missedTag}]: ${text.slice(0, 200)}`);

        // Build chat context
        const channelAuth = this.agent.getChannelAuth();
        const metadata: Record<string, string> = {
            telegramId: userId,
            chatId: String(chatId),
            userId: userId,
            displayName,
        };
        if (user.username) metadata.username = user.username;
        if (msg.chat.type !== 'private') {
            metadata.chatType = msg.chat.type;
            if (msg.chat.title) metadata.groupName = msg.chat.title;
        }

        // Check admin grant
        const role = channelAuth.getRole('telegram', userId);
        const isAdmin = role === 'admin' || role === 'owner';

        // Track session
        channelAuth.trackSession('telegram', userId, displayName, metadata);

        // Non-admin users: store in inbox, no response
        if (!isAdmin) {
            await this.addToInbox(msg, false);
            console.log(`[Telegram]: Stored message from ${who} (guest) in inbox — no reply`);
            return;
        }

        // ── Admin message — generate response ─────────

        const ctx: ChatContext = {
            channel: 'telegram',
            sender: displayName,
            isAdmin,
            metadata,
        };

        // Build message history for multi-turn context
        await this.sendTyping(chatId);
        const history = this.getOrCreateHistory(chatId);

        // Build parts array — text + optional image
        const parts: any[] = [];
        if (text) parts.push({ type: 'text' as const, text });
        if (imageData) {
            parts.push({ type: 'image' as const, image: imageData.base64, mediaType: imageData.mediaType });
            // If photo sent without caption, add a default prompt
            if (!text) parts.unshift({ type: 'text' as const, text: 'What is in this image?' });
        }

        const userMsg: UIMessage = {
            id: `tg-${msg.message_id}`,
            role: 'user' as const,
            parts,
        };
        history.push(userMsg);

        try {
            // Build enriched system prompt — include missed-message context
            let queryForPrompt = text;
            if (isMissed) {
                const msgTime = new Date(msg.date * 1000);
                const ago = humanTimeAgo(msgTime);
                queryForPrompt = `[This message was sent ${ago} while you were offline. Acknowledge that you were away and respond helpfully.]\n\n${text}`;
            }

            const systemPrompt = await this.agent.buildSystemPrompt(queryForPrompt, ctx);
            this.agent.saveToMemory('user', text, ctx);

            // Refresh typing every ~4 seconds during generation
            const typingInterval = setInterval(() => this.sendTyping(chatId), 4000);



            const { text: responseText } = await generateTextWithRetry({
                model: this.agent.getModel(),
                system: systemPrompt,
                messages: history.map(m => {
                    // Build multi-modal content array (text + images)
                    const contentParts: any[] = [];
                    for (const p of (m.parts || []) as any[]) {
                        if (p.type === 'text' && p.text) {
                            contentParts.push({ type: 'text', text: p.text });
                        } else if (p.type === 'image' && p.image) {
                            contentParts.push({ type: 'image', image: p.image, mediaType: p.mediaType });
                        }
                    }
                    // If only text, use simple string content (more compatible)
                    const content = contentParts.length === 1 && contentParts[0].type === 'text'
                        ? contentParts[0].text
                        : contentParts;
                    return { role: m.role as 'user' | 'assistant', content };
                }),
                tools: this.agent.getToolsForContext(ctx),
                stopWhen: stepCountIs(20),
                onStepFinish: ({ toolCalls }) => {
                    if (toolCalls?.length) {
                        console.log(`[Telegram/Agent]: ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`);

                        // Send progress update to user (non-blocking)
                        const labels = toolCalls.map((tc: any) =>
                            TelegramBridge.TOOL_LABELS[tc.toolName] || `⚙️ ${tc.toolName}`
                        );
                        // Deduplicate (e.g. multiple web_search calls)
                        const unique = [...new Set(labels)];
                        const progressText = unique.join('\n');
                        this.sendMessage(chatId, progressText).catch(() => { });

                        // Keep typing indicator going
                        this.sendTyping(chatId);
                    }
                },
            });

            clearInterval(typingInterval);

            // Save response to memory
            this.agent.saveToMemory('assistant', responseText);

            // Mark in inbox as responded
            await this.addToInbox(msg, true);

            // Add assistant message to history
            const asstMsg: UIMessage = {
                id: `tg-resp-${msg.message_id}`,
                role: 'assistant' as const,
                parts: [{ type: 'text' as const, text: responseText }],
            };
            history.push(asstMsg);
            this.trimHistory(chatId);

            // Send response (skip if empty — LLM may return no text after tool-only steps)
            if (responseText.trim()) {
                await this.sendMessage(chatId, responseText);
                console.log(`[Telegram/Agent → ${who}]: ${responseText.slice(0, 200)}${responseText.length > 200 ? '…' : ''}`);
            } else {
                console.log(`[Telegram/Agent → ${who}]: (empty response — tools ran but no text returned)`);
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[Telegram]: Error generating response for ${who}:`, errMsg);
            await this.sendMessage(chatId, "Sorry, I hit an error processing that. Try again in a moment.");
        }
    }

    // ── Chat history management ───────────────────────

    private getOrCreateHistory(chatId: number): UIMessage[] {
        if (!this.chatHistories.has(chatId)) {
            this.chatHistories.set(chatId, []);
        }
        return this.chatHistories.get(chatId)!;
    }

    private trimHistory(chatId: number): void {
        const history = this.chatHistories.get(chatId);
        if (history && history.length > this.MAX_HISTORY) {
            // Keep only the last MAX_HISTORY messages
            this.chatHistories.set(chatId, history.slice(-this.MAX_HISTORY));
        }
    }

    /** Clear chat history for a specific chat or all chats */
    clearHistory(chatId?: number): void {
        if (chatId) {
            this.chatHistories.delete(chatId);
        } else {
            this.chatHistories.clear();
        }
    }

    /** Get the bot info (null if not connected) */
    getBotInfo(): TelegramBotInfo | null {
        return this.botInfo;
    }

    /** Check if the bridge is running */
    isRunning(): boolean {
        return this.running;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Human-readable time ago string */
function humanTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds} second(s) ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute(s) ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour(s) ago`;
    const days = Math.floor(hours / 24);
    return `${days} day(s) ago`;
}
