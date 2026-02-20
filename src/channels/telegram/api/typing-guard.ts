/**
 * Typing Guard — rate-limited, auto-stopping typing indicator for Telegram.
 *
 * Prevents the 429 "Too Many Requests" spam from sendChatAction by:
 *   - Enforcing a minimum interval between API calls (default 5s)
 *   - Backing off exponentially on 429 errors
 *   - Auto-stopping after a maximum lifetime (default 5 minutes)
 *   - Providing a single .stop() to clean up
 *
 * Usage:
 *   const typing = createTypingGuard(token, chatId);
 *   typing.start();    // begins periodic typing, returns immediately
 *   typing.nudge();    // "I'm still working" — sends typing if enough time passed
 *   typing.stop();     // cancel everything, safe to call multiple times
 *
 * @module channels/telegram/api/typing-guard
 */

import { callApi } from './call-api';

const MIN_INTERVAL_MS = 5_000;       // Telegram typing lasts ~5s, so 5s is optimal
const BACKOFF_BASE_MS = 6_000;       // Start backoff at 6s on 429
const BACKOFF_MAX_MS = 60_000;       // Cap backoff at 60s
const MAX_LIFETIME_MS = 5 * 60_000;  // Auto-stop after 5 minutes (zombie protection)

export interface TypingGuard {
    /** Start the periodic typing indicator. Safe to call multiple times. */
    start(): void;
    /** Nudge — send typing if enough time has passed since last send. Fire-and-forget. */
    nudge(): void;
    /** Stop all typing. Safe to call multiple times. */
    stop(): void;
}

export function createTypingGuard(token: string, chatId: number): TypingGuard {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSentAt = 0;
    let currentInterval = MIN_INTERVAL_MS;
    let stopped = false;
    let startedAt = 0;

    async function send(): Promise<void> {
        if (stopped) return;

        // Auto-stop if we've been typing too long (zombie protection)
        if (startedAt && Date.now() - startedAt > MAX_LIFETIME_MS) {
            stop();
            return;
        }

        const now = Date.now();
        if (now - lastSentAt < MIN_INTERVAL_MS) return; // too soon

        try {
            await callApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
            lastSentAt = Date.now();
            currentInterval = MIN_INTERVAL_MS; // reset backoff on success
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('429') || msg.includes('Too Many Requests')) {
                // Parse retry_after from error if available, otherwise backoff
                const retryMatch = msg.match(/retry after (\d+)/i);
                const retryAfter = retryMatch ? parseInt(retryMatch[1], 10) * 1000 : 0;
                currentInterval = Math.min(
                    Math.max(retryAfter || currentInterval * 2, BACKOFF_BASE_MS),
                    BACKOFF_MAX_MS,
                );
                console.warn(`[TypingGuard]: 429 rate limit — backing off to ${(currentInterval / 1000).toFixed(0)}s`);
            }
            // All other errors: silently ignore (typing is cosmetic)
        }

        scheduleNext();
    }

    function scheduleNext(): void {
        if (stopped) return;
        timer = setTimeout(send, currentInterval);
    }

    function start(): void {
        if (stopped) return;
        if (timer) return; // already running
        startedAt = Date.now();
        send(); // fire immediately, then schedule
    }

    function nudge(): void {
        if (stopped) return;
        // Only send if enough time has passed — prevents rapid-fire from onStepFinish
        const now = Date.now();
        if (now - lastSentAt >= MIN_INTERVAL_MS) {
            send();
        }
    }

    function stop(): void {
        stopped = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    return { start, nudge, stop };
}
