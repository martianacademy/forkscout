/**
 * TelegramBridge — connects the Forkscout agent to a Telegram Bot via long polling.
 *
 * Coordinates the API wrapper, state manager, and message handler.
 */

import type { UIMessage } from 'ai';
import { resolve as resolvePath } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type { Agent } from '../../agent';
import { AGENT_ROOT } from '../../paths';
import type { TelegramBotInfo, TelegramBridgeConfig, TelegramUpdate, InboxMessage } from './types';
import { sleep } from './types';
import { callApi, getMe, sendMessage, sendPhoto, sendDocument } from './api';
import { TelegramStateManager } from './state';
import { handleTelegramUpdate } from './handler';

export class TelegramBridge {
    private token: string;
    private maxMsgLen: number;
    private state: TelegramStateManager;
    private agent: Agent;
    private pollTimeout: number;

    private offset = 0;
    private running = false;
    private botInfo: TelegramBotInfo | null = null;
    private startedAt = 0;

    // Per-chat message history for multi-turn context
    private chatHistories: Map<number, UIMessage[]> = new Map();
    private readonly MAX_HISTORY = 20;
    private historyPath: string;
    private historyDirty = false;

    constructor(agent: Agent, config: TelegramBridgeConfig) {
        this.agent = agent;
        this.token = config.token;
        this.maxMsgLen = config.maxMessageLength ?? 4096;
        this.pollTimeout = config.pollTimeout ?? 30;

        const dataDir = resolvePath(AGENT_ROOT, '.forkscout');
        this.state = new TelegramStateManager(resolvePath(dataDir, 'telegram-state.json'));
        this.historyPath = resolvePath(dataDir, 'telegram-history.json');
    }

    // ── Lifecycle ─────────────────────────────────────

    /** Start the long-polling loop */
    async start(): Promise<void> {
        // Verify token
        try {
            this.botInfo = await getMe(this.token);
            console.log(`\n📱 Telegram bridge connected: @${this.botInfo.username} (${this.botInfo.first_name})`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Telegram bridge failed to connect: ${msg}`);
            return;
        }

        // Load persisted state (offset + inbox)
        const { offset } = await this.state.loadState();
        this.offset = offset;
        this.startedAt = Math.floor(Date.now() / 1000);
        this.running = true;

        // Load persisted chat histories
        await this.loadHistories();

        // Process any missed messages from Telegram's queue
        await this.processMissedMessages();

        this.poll(); // fire and forget — runs forever
    }

    /** Stop polling and save state */
    async stop(): Promise<void> {
        this.running = false;
        await Promise.all([
            this.state.saveShutdownState(this.offset),
            this.saveHistories(),
        ]);
        console.log('📱 Telegram bridge stopped (state + history saved)');
    }

    // ── Polling ───────────────────────────────────────

    /**
     * On startup, fetch any queued updates from Telegram.
     * These are messages sent while the bot was offline.
     */
    private async processMissedMessages(): Promise<void> {
        try {
            const updates = await callApi<TelegramUpdate[]>(this.token, 'getUpdates', {
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

            this.state.markDirty();
            await this.state.saveState(this.offset, this.startedAt);
            console.log(`[Telegram]: Finished processing missed messages`);
        } catch (err) {
            console.error(`[Telegram]: Error fetching missed messages:`, err instanceof Error ? err.message : err);
        }
    }

    /** Continuous long-polling loop */
    private async poll(): Promise<void> {
        while (this.running) {
            try {
                const updates = await callApi<TelegramUpdate[]>(this.token, 'getUpdates', {
                    offset: this.offset,
                    timeout: this.pollTimeout,
                    allowed_updates: ['message'],
                });

                for (const update of updates) {
                    this.offset = update.update_id + 1;
                    this.state.markDirty();
                    await this.handleUpdate(update, false).catch(err => {
                        console.error(`[Telegram]: Error handling update ${update.update_id}:`, err);
                    });
                }

                if (this.state.isDirty) {
                    await this.state.saveState(this.offset, this.startedAt);
                }
                if (this.historyDirty) {
                    await this.saveHistories();
                }
            } catch (err) {
                if (this.running) {
                    console.error(`[Telegram]: Polling error — retrying in 5s:`, err instanceof Error ? err.message : err);
                    await sleep(5000);
                }
            }
        }
    }

    /** Delegate to the handler with injected dependencies */
    private async handleUpdate(update: TelegramUpdate, isMissed: boolean): Promise<void> {
        return handleTelegramUpdate(update, isMissed, {
            agent: this.agent,
            token: this.token,
            state: this.state,
            getOrCreateHistory: (chatId) => this.getOrCreateHistory(chatId),
            trimHistory: (chatId) => this.trimHistory(chatId),
        });
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
            this.chatHistories.set(chatId, history.slice(-this.MAX_HISTORY));
        }
        this.historyDirty = true;
    }

    /** Clear chat history for a specific chat or all chats */
    clearHistory(chatId?: number): void {
        if (chatId) {
            this.chatHistories.delete(chatId);
        } else {
            this.chatHistories.clear();
        }
        this.historyDirty = true;
    }

    // ── History persistence ─────────────────────────────

    /** Strip binary image data from parts before saving (base64 is huge) */
    private static stripBinaryParts(parts: any[]): any[] {
        return parts.map(p => {
            if (p.type === 'image') return { type: 'image', note: '(image omitted from history)' };
            return p;
        });
    }

    /** Load chat histories from disk */
    private async loadHistories(): Promise<void> {
        try {
            const raw = await readFile(this.historyPath, 'utf-8');
            const data: Record<string, UIMessage[]> = JSON.parse(raw);
            this.chatHistories.clear();
            let totalMessages = 0;
            for (const [chatIdStr, messages] of Object.entries(data)) {
                const chatId = Number(chatIdStr);
                if (!isNaN(chatId) && Array.isArray(messages)) {
                    // Keep only the last MAX_HISTORY messages
                    this.chatHistories.set(chatId, messages.slice(-this.MAX_HISTORY));
                    totalMessages += this.chatHistories.get(chatId)!.length;
                }
            }
            console.log(`[Telegram]: Loaded ${totalMessages} message(s) across ${this.chatHistories.size} chat(s) from history`);
        } catch {
            // First run or corrupted — start with empty histories
        }
    }

    /** Save chat histories to disk (strip binary data to keep file small) */
    private async saveHistories(): Promise<void> {
        if (!this.historyDirty) return;
        try {
            const dir = resolvePath(this.historyPath, '..');
            await mkdir(dir, { recursive: true });

            const data: Record<string, any[]> = {};
            for (const [chatId, messages] of this.chatHistories) {
                // Only persist the last MAX_HISTORY messages, strip binary data
                data[String(chatId)] = messages.slice(-this.MAX_HISTORY).map(m => ({
                    ...m,
                    parts: TelegramBridge.stripBinaryParts(m.parts || []),
                }));
            }

            await writeFile(this.historyPath, JSON.stringify(data, null, 2), 'utf-8');
            this.historyDirty = false;
        } catch (err) {
            console.error('[Telegram]: Failed to save history:', err instanceof Error ? err.message : err);
        }
    }

    // ── Public accessors ──────────────────────────────

    /** Get the bot info (null if not connected) */
    getBotInfo(): TelegramBotInfo | null {
        return this.botInfo;
    }

    /** Check if the bridge is running */
    isRunning(): boolean {
        return this.running;
    }

    /** Get unresponded inbox messages */
    getUnrespondedMessages(userId?: string): InboxMessage[] {
        return this.state.getUnrespondedMessages(userId);
    }

    /** Send a message via the API (public — used by telegram tools) */
    async sendMessage(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
        return sendMessage(this.token, chatId, text, replyToMessageId, this.maxMsgLen);
    }

    /** Send a photo via the API (public — used by telegram tools) */
    async sendPhoto(chatId: number, filePath: string, caption?: string): Promise<void> {
        return sendPhoto(this.token, chatId, filePath, caption);
    }

    /** Send a document via the API (public — used by telegram tools) */
    async sendDocument(chatId: number, filePath: string, caption?: string): Promise<void> {
        return sendDocument(this.token, chatId, filePath, caption);
    }
}
