/**
 * Edit an existing Telegram message in-place.
 *
 * Used to replace an ack placeholder ("On it! 🔍") with the final agent
 * response, so the user sees one seamless message instead of two.
 *
 * Falls back silently if the message is too old (48h Telegram limit) or
 * was already deleted — caller should then send a fresh message.
 *
 * @param token     - Telegram Bot API token
 * @param chatId    - Target chat / user ID
 * @param messageId - ID of the message to edit
 * @param text      - New message text (truncated to 4 096 chars)
 * @returns true if the edit succeeded, false if it failed
 */
import { callApi } from './call-api';
import { sanitizeTelegramMarkdown } from './sanitize-markdown';

export async function editMessage(
    token: string,
    chatId: number,
    messageId: number,
    text: string,
): Promise<boolean> {
    const sanitized = sanitizeTelegramMarkdown(text.slice(0, 4096));

    try {
        await callApi(token, 'editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: sanitized,
            parse_mode: 'Markdown',
        });
        return true;
    } catch {
        // Markdown failed — retry plain text
        try {
            await callApi(token, 'editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: text.slice(0, 4096),
            });
            return true;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[Telegram API] editMessage failed (msg ${messageId}): ${reason.slice(0, 100)}`);
            return false;
        }
    }
}
