/**
 * Show a "typing…" chat action indicator in a Telegram chat.
 *
 * Tells the Telegram client to show "Bot is typing…" for ~5 seconds.
 * Silently swallows errors — this is a cosmetic hint, not critical.
 *
 * Call this periodically (every ~4 s) during long-running operations.
 *
 * @param token  - Telegram Bot API token
 * @param chatId - Target chat / user ID
 *
 * @example
 * ```ts
 * await sendTyping(token, chatId);
 * const typingLoop = setInterval(() => sendTyping(token, chatId), 4000);
 * // ... do work ...
 * clearInterval(typingLoop);
 * ```
 */
import { callApi } from './call-api';

export async function sendTyping(token: string, chatId: number): Promise<void> {
    try {
        await callApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    } catch {
        // Non-critical — silently ignore failures
    }
}
