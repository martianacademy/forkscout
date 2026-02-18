/**
 * Send a text message to a Telegram chat.
 *
 * Automatically splits long messages at paragraph / newline / sentence
 * boundaries so they stay within Telegram's 4 096-character limit.
 * Attempts Markdown formatting first; falls back to plain text if
 * Telegram rejects the Markdown.
 *
 * @param token            - Telegram Bot API token
 * @param chatId           - Target chat / user ID
 * @param text             - Message text (may exceed 4 096 chars)
 * @param replyToMessageId - Optional message ID to reply to
 * @param maxLen           - Max chunk length (default: 4 096 — Telegram limit)
 *
 * @throws {Error} If both Markdown and plain-text sends fail
 *
 * @example
 * ```ts
 * await sendMessage(token, chatId, 'Hello *world*!');
 * await sendMessage(token, chatId, longReport, undefined, 4096);
 * ```
 */
import { callApi } from './call-api';
import { splitMessage } from './split-message';
import { sanitizeTelegramMarkdown } from './sanitize-markdown';

export async function sendMessage(
    token: string,
    chatId: number,
    text: string,
    replyToMessageId?: number,
    maxLen = 4096,
): Promise<void> {
    // Sanitize standard Markdown → Telegram-safe Markdown before splitting
    const sanitized = sanitizeTelegramMarkdown(text);
    const chunks = splitMessage(sanitized, maxLen);

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : '';

        try {
            await callApi(token, 'sendMessage', {
                chat_id: chatId,
                text: chunk,
                parse_mode: 'Markdown',
                ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            });
        } catch {
            // Markdown parse failed — retry as plain text
            console.warn(`[Telegram API] Markdown rejected for chat ${chatId}${chunkLabel}, retrying plain text`);
            await callApi(token, 'sendMessage', {
                chat_id: chatId,
                text: chunk,
                ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
            });
        }
    }
}
