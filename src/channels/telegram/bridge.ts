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

        // Process any missed messages from Telegram's queue
        await this.processMissedMessages();

        // Resume any conversations interrupted by a restart
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
     * Two cases:
     *   1. Last message is role='user' — agent hadn't started any tool calls yet
     *   2. History contains checkpoint messages — agent was mid-task with progress
     * In both cases: pop the orphan user message, reconstruct the update,
     * and re-run through the handler (with resume context if checkpoints exist).
     */
    private async resumeInterruptedChats(): Promise<void> {
        const interrupted: Array<{ chatId: number; hasCheckpoints: boolean }> = [];

        for (const [chatId, history] of this.chatHistories) {
            if (history.length === 0) continue;

            const lastMsg = history[history.length - 1];

            // Case 1: Last message is user (no steps completed before restart)
            if (lastMsg.role === 'user') {
                interrupted.push({ chatId, hasCheckpoints: false });
                continue;
            }

            // Case 2: Has checkpoint messages (agent was mid-task with progress)
            if (history.some(m => m.id.startsWith('checkpoint-'))) {
                interrupted.push({ chatId, hasCheckpoints: true });
            }
        }

        if (interrupted.length === 0) return;

        console.log(`[Telegram]: Found ${interrupted.length} interrupted conversation(s) — resuming…`);

        for (const { chatId, hasCheckpoints } of interrupted) {
            const history = this.chatHistories.get(chatId)!;

            // Build resume context from checkpoints if the agent had made progress
            let resumeContext: string | undefined;
            if (hasCheckpoints) {
                const checkpoints = history.filter(m => m.id.startsWith('checkpoint-'));
                const summaries = checkpoints.map(cp => {
                    const text = (cp.parts?.[0] as any)?.text || '';
                    return text;
                }).join('\n\n');

                // Extract working context: directories and files the agent was
                // operating on in the last few steps, so the model knows WHERE
                // it was, not just WHAT it did.
                const workingPaths = new Set<string>();
                const recentCheckpoints = checkpoints.slice(-5); // last 5 steps
                for (const cp of recentCheckpoints) {
                    const text = (cp.parts?.[0] as any)?.text || '';
                    // Extract paths from Args JSON
                    const pathMatch = text.match(/"(?:path|cwd|file|directory)":\s*"([^"]+)"/g);
                    if (pathMatch) {
                        for (const m of pathMatch) {
                            const val = m.match(/":\s*"([^"]+)"/)?.[1];
                            if (val) workingPaths.add(val);
                        }
                    }
                    // Extract cd paths from commands
                    const cdMatch = text.match(/cd\s+(\/[^\s&|;]+)/g);
                    if (cdMatch) {
                        for (const m of cdMatch) {
                            workingPaths.add(m.replace('cd ', ''));
                        }
                    }
                }

                const workingCtx = workingPaths.size > 0
                    ? `\nWORKING CONTEXT — You were operating in/on these paths:\n${[...workingPaths].map(p => `  • ${p}`).join('\n')}\n`
                    : '';

                // Extract reasoning/plan text from checkpoints so the model
                // remembers its high-level intent, not just individual tool calls.
                const reasoningLines: string[] = [];
                for (const cp of checkpoints) {
                    const text = (cp.parts?.[0] as any)?.text || '';
                    const reasoningMatch = text.match(/Reasoning: (.+?)(?:\n  Tool:|$)/s);
                    if (reasoningMatch?.[1]?.trim()) {
                        reasoningLines.push(reasoningMatch[1].trim());
                    }
                }
                // Deduplicate and take the most meaningful reasoning snippets
                const uniqueReasoning = [...new Set(reasoningLines)].slice(0, 5);
                const taskPlan = uniqueReasoning.length > 0
                    ? `\nYOUR PLAN/REASONING before the restart:\n${uniqueReasoning.map(r => `  > ${r.slice(0, 300)}`).join('\n')}\n`
                    : '';

                resumeContext = [
                    '⚠️ CONTINUATION AFTER RESTART:',
                    'You were previously working on this task but the process was restarted',
                    '(possibly because your own code changes triggered a rebuild).',
                    workingCtx,
                    taskPlan,
                    'Here are the steps you already completed before the restart:',
                    '',
                    summaries,
                    '',
                    'IMPORTANT: Continue from where you left off. Do NOT repeat steps that already succeeded.',
                    'If a step partially failed or was interrupted, you may retry it.',
                    'Pay attention to the WORKING CONTEXT and YOUR PLAN above — that is what you were doing and where.',
                ].join('\n');

                // Remove checkpoints from history so the user message is last
                for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].id.startsWith('checkpoint-')) {
                        history.splice(i, 1);
                    }
                }
            }

            // The last message should now be the user message
            const lastMsg = history[history.length - 1];
            if (!lastMsg || lastMsg.role !== 'user') {
                console.log(`[Telegram]: Can't resume chat ${chatId} — unexpected history state`);
                continue;
            }

            // Extract the raw Telegram message JSON from the stored user parts
            const textPart = (lastMsg.parts || []).find(
                (p: any) => p.type === 'text' && typeof p.text === 'string' && p.text.startsWith('[Telegram Message]'),
            ) as { type: string; text: string } | undefined;

            if (!textPart) {
                console.log(`[Telegram]: Can't resume chat ${chatId} — no raw message in history`);
                continue;
            }

            try {
                const rawJson = textPart.text.replace('[Telegram Message]\n', '');
                const originalMsg = JSON.parse(rawJson);

                // Pop the orphan — the handler will re-push it normally
                history.pop();

                // Notify user we're resuming
                const resumeMsg = hasCheckpoints
                    ? '🔄 I was interrupted mid-task — resuming where I left off…'
                    : '🔄 I was interrupted — picking up your message…';
                await sendMessage(this.token, chatId, resumeMsg);

                // Re-process through the normal handler (with resume context if available)
                const syntheticUpdate: TelegramUpdate = {
                    update_id: 0,
                    message: originalMsg,
                };

                await handleTelegramUpdate(syntheticUpdate, false, this.getHandlerDeps(), resumeContext);
                console.log(`[Telegram]: Successfully resumed chat ${chatId}${hasCheckpoints ? ' (with progress context)' : ''}`);
            } catch (err) {
                console.error(`[Telegram]: Failed to resume chat ${chatId}:`, err instanceof Error ? err.message : err);
                await sendMessage(this.token, chatId, "I was interrupted and couldn't resume. Could you send your message again?").catch(err =>
                    console.warn(`[Telegram]: Resume notification send failed for chat ${chatId}: ${err instanceof Error ? err.message : err}`),
                );
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
                    // Keep only the last maxHistory messages
                    this.chatHistories.set(chatId, messages.slice(-this.maxHistory));
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
