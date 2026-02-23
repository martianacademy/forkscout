/**
 * TelegramBridge — connects the Forkscout agent to a Telegram Bot via long polling.
 *
 * Coordinates the API wrapper, state manager, and message handler.
 */

import type { UIMessage } from 'ai';
import { resolve as resolvePath } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type { Agent } from '../../agent';
import { getConfig } from '../../config';
import { AGENT_ROOT } from '../../paths';
import type { TelegramBotInfo, TelegramBridgeConfig, TelegramUpdate, InboxMessage } from './types';
import { sleep } from './types';
import { callApi, getMe, sendMessage, sendPhoto, sendDocument, sendVoice } from './api';
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
    /** Fallback — prefer getConfig().agent.telegram.maxHistory */
    private get maxHistory(): number {
        return getConfig().agent.telegram?.maxHistory ?? 20;
    }
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

        // Check for interrupted conversations — ask user before resuming
        await this.resumeInterruptedChats();

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
    /** Continuous long-polling loop */
    private async poll(): Promise<void> {
        while (this.running) {
            try {
                const updates = await callApi<TelegramUpdate[]>(this.token, 'getUpdates', {
                    offset: this.offset,
                    timeout: this.pollTimeout,
                    allowed_updates: ['message'],
                });

                // Deduplicate: when multiple messages arrive from the same chat
                // in one poll batch, skip all but the LAST per chat.
                // This prevents sequential processing of duplicate user messages
                // (e.g. user re-sends while agent is processing the first one).
                const lastPerChat = new Map<number, number>(); // chatId → index
                for (let i = 0; i < updates.length; i++) {
                    const chatId = updates[i].message?.chat?.id;
                    if (chatId != null) lastPerChat.set(chatId, i);
                }

                for (let i = 0; i < updates.length; i++) {
                    const update = updates[i];
                    this.offset = update.update_id + 1;
                    this.state.markDirty();

                    const chatId = update.message?.chat?.id;
                    if (chatId != null && lastPerChat.get(chatId) !== i) {
                        // Skip — a newer message from this chat exists in the same batch
                        console.log(`[Telegram]: Skipping update ${update.update_id} (superseded by newer message in chat ${chatId})`);
                        continue;
                    }

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
        return handleTelegramUpdate(update, isMissed, this.getHandlerDeps());
    }

    /** Build the deps object passed to the handler */
    private getHandlerDeps(): import('./handler').TelegramHandlerDeps {
        return {
            agent: this.agent,
            token: this.token,
            state: this.state,
            getOrCreateHistory: (chatId) => this.getOrCreateHistory(chatId),
            trimHistory: (chatId) => this.trimHistory(chatId),
            flushHistory: () => this.saveHistoriesForce(),
        };
    }

    // ── Interrupted chat resume ──────────────────────

    /**
     * After startup, detect conversations interrupted by a restart.
     * Instead of auto-resuming (which frustrates users who intentionally stopped
     * the agent), we ASK the user if they want to continue.
     *
     * The orphaned user message stays in history — if the user says "continue",
     * the agent sees the prior context naturally. If they send something else,
     * normal flow handles it.
     */
    private async resumeInterruptedChats(): Promise<void> {
        const interrupted: Array<{ chatId: number }> = [];

        for (const [chatId, history] of this.chatHistories) {
            if (history.length === 0) continue;

            // Clean any stale checkpoints first (from prior crashes)
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].id.startsWith('checkpoint-')) {
                    history.splice(i, 1);
                }
            }

            const lastMsg = history[history.length - 1];

            // If last message is user (no assistant reply), this was interrupted.
            // Add an assistant message noting the restart so the agent doesn't
            // auto-continue. Context is preserved — if the user says "continue",
            // the agent sees the original task in history.
            if (lastMsg && lastMsg.role === 'user') {
                const restartNote: UIMessage = {
                    id: `restart-note-${Date.now()}`,
                    role: 'assistant' as const,
                    parts: [{ type: 'text' as const, text: '[SYSTEM: Process was restarted before completing your request. Waiting for user to decide whether to continue or start fresh.]' }],
                };
                history.push(restartNote);
                interrupted.push({ chatId });
            }
        }

        if (interrupted.length === 0) return;

        // Save cleaned history to disk
        this.historyDirty = true;

        console.log(`[Telegram]: Found ${interrupted.length} interrupted conversation(s) — asking user to confirm resume`);

        for (const { chatId } of interrupted) {
            try {
                await sendMessage(
                    this.token, chatId,
                    '⚠️ I was restarted while we were in the middle of something.\n\n' +
                    'Would you like me to continue where I left off, or do you want to start fresh? Just let me know!',
                );
            } catch (err) {
                console.warn(`[Telegram]: Resume notification failed for chat ${chatId}: ${err instanceof Error ? err.message : err}`);
            }
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
        if (history && history.length > this.maxHistory) {
            this.chatHistories.set(chatId, history.slice(-this.maxHistory));
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

    /**
     * Migrate legacy history entries that stored raw Telegram JSON blobs.
     * Extracts just the text content from `[Telegram Message]\n{...JSON...}` format.
     * This is a one-time migration — after save, the cleaned format persists.
     */
    private static migrateJsonBlobs(messages: UIMessage[]): { messages: UIMessage[]; migrated: number } {
        let migrated = 0;
        const result = messages.map(m => {
            if (m.role !== 'user' || !m.parts) return m;
            const newParts = m.parts.map((p: any) => {
                if (p.type !== 'text' || !p.text?.startsWith('[Telegram Message]\n{')) return p;
                // Extract text from the raw JSON blob
                try {
                    const jsonStr = p.text.slice('[Telegram Message]\n'.length);
                    const parsed = JSON.parse(jsonStr);
                    const text = parsed.text || parsed.caption || 'Message';
                    migrated++;
                    return { type: 'text' as const, text };
                } catch {
                    return p; // If parsing fails, keep as-is
                }
            });
            return { ...m, parts: newParts };
        });
        return { messages: result, migrated };
    }

    /** Load chat histories from disk */
    private async loadHistories(): Promise<void> {
        try {
            const raw = await readFile(this.historyPath, 'utf-8');
            const data: Record<string, UIMessage[]> = JSON.parse(raw);
            this.chatHistories.clear();
            let totalMessages = 0;
            let totalMigrated = 0;
            for (const [chatIdStr, messages] of Object.entries(data)) {
                const chatId = Number(chatIdStr);
                if (!isNaN(chatId) && Array.isArray(messages)) {
                    // Filter out stale checkpoints (from prior crashes) and keep last maxHistory
                    const clean = messages.filter(m => !m.id?.startsWith('checkpoint-'));
                    // Migrate legacy raw JSON blobs → clean text
                    const { messages: migrated, migrated: count } = TelegramBridge.migrateJsonBlobs(clean);
                    totalMigrated += count;
                    this.chatHistories.set(chatId, migrated.slice(-this.maxHistory));
                    const removed = messages.length - clean.length;
                    if (removed > 0) console.log(`[Telegram]: Purged ${removed} stale checkpoint(s) from chat ${chatId}`);
                    totalMessages += this.chatHistories.get(chatId)!.length;
                }
            }
            if (totalMigrated > 0) {
                console.log(`[Telegram]: Migrated ${totalMigrated} message(s) from raw JSON to clean text format`);
                this.historyDirty = true; // Trigger save to persist the migration
            }
            console.log(`[Telegram]: Loaded ${totalMessages} message(s) across ${this.chatHistories.size} chat(s) from history`);
            // Persist migration immediately if any messages were cleaned
            if (this.historyDirty) await this.saveHistoriesForce();
        } catch {
            // First run or corrupted — start with empty histories
        }
    }

    /** Save chat histories to disk (strip binary data to keep file small) */
    private async saveHistories(): Promise<void> {
        if (!this.historyDirty) return;
        return this.saveHistoriesForce();
    }

    /** Save chat histories unconditionally (called by handler after pushing userMsg) */
    private async saveHistoriesForce(): Promise<void> {
        try {
            const dir = resolvePath(this.historyPath, '..');
            await mkdir(dir, { recursive: true });

            const data: Record<string, any[]> = {};
            for (const [chatId, messages] of this.chatHistories) {
                // Only persist the last maxHistory messages, strip binary data
                data[String(chatId)] = messages.slice(-this.maxHistory).map(m => ({
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
        await sendMessage(this.token, chatId, text, replyToMessageId, this.maxMsgLen);
    }

    /** Send a photo via the API (public — used by telegram tools) */
    async sendPhoto(chatId: number, filePath: string, caption?: string): Promise<void> {
        return sendPhoto(this.token, chatId, filePath, caption);
    }

    /** Send a document via the API (public — used by telegram tools) */
    async sendDocument(chatId: number, filePath: string, caption?: string): Promise<void> {
        return sendDocument(this.token, chatId, filePath, caption);
    }

    /** Send a voice message via the API (public — used by telegram tools) */
    async sendVoice(chatId: number, filePath: string, caption?: string): Promise<void> {
        return sendVoice(this.token, chatId, filePath, caption);
    }
}
