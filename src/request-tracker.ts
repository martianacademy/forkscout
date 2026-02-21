/**
 * Request Tracker — manages active LLM requests with abort capability.
 *
 * Each active chat request is tracked with an AbortController. The agent
 * or user can abort any request by ID (or abort all). This prevents the
 * agent from getting stuck in long tool-calling loops without needing
 * to restart the server.
 *
 * Usage:
 *   const { id, signal } = tracker.start('telegram-12345');
 *   // pass `signal` as abortSignal to generateText / streamText
 *   tracker.abort(id);   // cancel a specific request
 *   tracker.abortAll();  // cancel all active requests
 *
 * @module request-tracker
 */

export interface ActiveRequest {
    id: string;
    /** Channel (http-stream, http-sync, telegram) */
    channel: string;
    /** Chat/conversation identifier (e.g. Telegram chatId, HTTP session) */
    chatId?: string;
    /** Who initiated the request */
    sender?: string;
    /** When the request started */
    startedAt: number;
    /** The AbortController for this request */
    controller: AbortController;
}

export class RequestTracker {
    private active = new Map<string, ActiveRequest>();
    private counter = 0;

    /**
     * Start tracking a new request. Returns a unique ID and an AbortSignal
     * to pass into generateText/streamText.
     */
    start(channel: string, sender?: string, chatId?: string): { id: string; signal: AbortSignal } {
        const id = `req-${++this.counter}-${Date.now()}`;
        const controller = new AbortController();

        this.active.set(id, {
            id,
            channel,
            chatId,
            sender,
            startedAt: Date.now(),
            controller,
        });

        console.log(`[Tracker]: Started ${id} (${channel}${chatId ? `, chat=${chatId}` : ''}${sender ? `, ${sender}` : ''})`);
        return { id, signal: controller.signal };
    }

    /**
     * Mark a request as finished (completed or errored). Removes it from tracking.
     */
    finish(id: string): void {
        if (this.active.delete(id)) {
            console.log(`[Tracker]: Finished ${id}`);
        }
    }

    /**
     * Abort a specific request by ID.
     * Returns true if the request was found and aborted.
     */
    abort(id: string): boolean {
        const req = this.active.get(id);
        if (!req) return false;

        console.log(`[Tracker]: Aborting ${id} (${req.channel}, running for ${this.elapsed(req)}s)`);
        req.controller.abort();
        this.active.delete(id);
        return true;
    }

    /**
     * Abort ALL active requests. Returns the count of aborted requests.
     */
    abortAll(): number {
        const count = this.active.size;
        if (count === 0) return 0;

        console.log(`[Tracker]: Aborting ALL ${count} active request(s)`);
        for (const [id, req] of this.active) {
            req.controller.abort();
            console.log(`  ↳ Aborted ${id} (${req.channel}, ${this.elapsed(req)}s)`);
        }
        this.active.clear();
        return count;
    }

    /**
     * Abort all active requests for a specific chat/conversation.
     * Only aborts requests matching the given channel + chatId.
     * Returns the count of aborted requests.
     */
    abortByChat(channel: string, chatId: string): number {
        let count = 0;
        for (const [id, req] of this.active) {
            if (req.channel === channel && req.chatId === chatId) {
                console.log(`[Tracker]: Aborting ${id} (${req.channel}, chat=${chatId}, ${this.elapsed(req)}s)`);
                req.controller.abort();
                this.active.delete(id);
                count++;
            }
        }
        return count;
    }

    /**
     * Count active requests for a specific chat/conversation.
     */
    countByChat(channel: string, chatId: string): number {
        let count = 0;
        for (const req of this.active.values()) {
            if (req.channel === channel && req.chatId === chatId) count++;
        }
        return count;
    }

    /**
     * List all active requests (for the /api/status or abort UI).
     */
    list(): Array<{ id: string; channel: string; sender?: string; startedAt: number; elapsedMs: number }> {
        return Array.from(this.active.values()).map(r => ({
            id: r.id,
            channel: r.channel,
            sender: r.sender,
            startedAt: r.startedAt,
            elapsedMs: Date.now() - r.startedAt,
        }));
    }

    /** Number of currently active requests */
    get size(): number {
        return this.active.size;
    }

    private elapsed(req: ActiveRequest): string {
        return ((Date.now() - req.startedAt) / 1000).toFixed(1);
    }
}

/** Singleton tracker instance shared across the server */
export const requestTracker = new RequestTracker();
