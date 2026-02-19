/**
 * Telegram persistent state — offset tracking + inbox for queued messages.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve as resolvePath } from 'path';
import type { InboxMessage, TelegramMessage, TelegramState } from './types';
import { getConfig } from '../../config';

export class TelegramStateManager {
    private statePath: string;
    private inbox: InboxMessage[] = [];
    private stateDirty = false;

    /** Fallback — prefer getConfig().agent.telegram.maxInbox */
    private get maxInbox(): number {
        return getConfig().agent.telegram?.maxInbox ?? 200;
    }

    constructor(statePath: string) {
        this.statePath = statePath;
    }

    /** Load state from disk (offset, inbox). Returns the saved offset and shutdown timestamp. */
    async loadState(): Promise<{ offset: number; lastStoppedAt: number }> {
        try {
            const raw = await readFile(this.statePath, 'utf-8');
            const state: TelegramState = JSON.parse(raw);
            this.inbox = state.inbox || [];
            console.log(
                `[Telegram]: Loaded state — offset: ${state.offset || 0}, inbox: ${this.inbox.length} message(s), ` +
                `last stopped: ${state.lastStoppedAt ? new Date(state.lastStoppedAt * 1000).toISOString() : 'never'}`,
            );
            return { offset: state.offset || 0, lastStoppedAt: state.lastStoppedAt || 0 };
        } catch {
            // First run or corrupted — start fresh
            this.inbox = [];
            return { offset: 0, lastStoppedAt: 0 };
        }
    }

    /** Save state to disk */
    async saveState(offset: number, startedAt: number): Promise<void> {
        if (!this.stateDirty) return;
        const dir = resolvePath(this.statePath, '..');
        await mkdir(dir, { recursive: true });
        const state: TelegramState = {
            offset,
            lastStartedAt: startedAt,
            lastStoppedAt: 0,
            inbox: this.inbox.slice(-this.maxInbox),
            version: 1,
        };
        await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
        this.stateDirty = false;
    }

    /** Save shutdown timestamp */
    async saveShutdownState(offset: number): Promise<void> {
        try {
            const raw = await readFile(this.statePath, 'utf-8');
            const state: TelegramState = JSON.parse(raw);
            state.lastStoppedAt = Math.floor(Date.now() / 1000);
            state.offset = offset;
            state.inbox = this.inbox.slice(-this.maxInbox);
            await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
        } catch {
            // Best effort
        }
    }

    /** Add a message to the persistent inbox */
    async addToInbox(msg: TelegramMessage, responded: boolean): Promise<void> {
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
        if (this.inbox.length > this.maxInbox) {
            this.inbox = this.inbox.slice(-this.maxInbox);
        }
        this.stateDirty = true;
    }

    /** Get unresponded inbox messages */
    getUnrespondedMessages(userId?: string): InboxMessage[] {
        const msgs = this.inbox.filter(m => !m.responded);
        return userId ? msgs.filter(m => m.userId === userId) : msgs;
    }

    /** Mark state as dirty (e.g. after processing updates) */
    markDirty(): void {
        this.stateDirty = false;
        this.stateDirty = true;
    }

    get isDirty(): boolean {
        return this.stateDirty;
    }
}
