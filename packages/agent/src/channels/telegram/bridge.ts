/**
 * TelegramBridge — connects the Forkscout agent to a Telegram Bot via long polling.
 *
 * Coordinates the API wrapper, state manager, and message handler.
 */

import type { UIMessage } from 'ai';
import { resolve as resolvePath } from 'path';
import type { Agent } from '../../agent';
import { AGENT_ROOT } from '../../paths';
import type { TelegramBotInfo, TelegramBridgeConfig, TelegramUpdate, InboxMessage } from './types';
import { sleep } from './types';
import { TelegramApi } from './api';
import { TelegramStateManager } from './state';
import { handleTelegramUpdate } from './handler';

export class TelegramBridge {
    private api: TelegramApi;
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

    constructor(agent: Agent, config: TelegramBridgeConfig) {
        this.agent = agent;
        this.pollTimeout = config.pollTimeout ?? 30;

        this.api = new TelegramApi(config.token, config.maxMessageLength ?? 4096);

        const dataDir = resolvePath(AGENT_ROOT, '.forkscout');
        this.state = new TelegramStateManager(resolvePath(dataDir, 'telegram-state.json'));
    }

    // ── Lifecycle ─────────────────────────────────────

    /** Start the long-polling loop */
    async start(): Promise<void> {
        // Verify token
        try {
            this.botInfo = await this.api.getMe();
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

        // Process any missed messages from Telegram's queue
        await this.processMissedMessages();

        this.poll(); // fire and forget — runs forever
    }

    /** Stop polling and save state */
    async stop(): Promise<void> {
        this.running = false;
        await this.state.saveShutdownState(this.offset);
        console.log('📱 Telegram bridge stopped (state saved)');
    }

    // ── Polling ───────────────────────────────────────

    /**
     * On startup, fetch any queued updates from Telegram.
     * These are messages sent while the bot was offline.
     */
    private async processMissedMessages(): Promise<void> {
        try {
            const updates = await this.api.call<TelegramUpdate[]>('getUpdates', {
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
                const updates = await this.api.call<TelegramUpdate[]>('getUpdates', {
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
            api: this.api,
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
    }

    /** Clear chat history for a specific chat or all chats */
    clearHistory(chatId?: number): void {
        if (chatId) {
            this.chatHistories.delete(chatId);
        } else {
            this.chatHistories.clear();
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

    /** Get the API wrapper (for telegram tools) */
    getApi(): TelegramApi {
        return this.api;
    }

    /** Get unresponded inbox messages */
    getUnrespondedMessages(userId?: string): InboxMessage[] {
        return this.state.getUnrespondedMessages(userId);
    }

    /** Send a message via the API (public — used by telegram tools) */
    async sendMessage(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
        return this.api.sendMessage(chatId, text, replyToMessageId);
    }

    /** Send a photo via the API (public — used by telegram tools) */
    async sendPhoto(chatId: number, filePath: string, caption?: string): Promise<void> {
        return this.api.sendPhoto(chatId, filePath, caption);
    }

    /** Send a document via the API (public — used by telegram tools) */
    async sendDocument(chatId: number, filePath: string, caption?: string): Promise<void> {
        return this.api.sendDocument(chatId, filePath, caption);
    }
}
