/**
 * Verify the bot token and retrieve bot identity.
 *
 * Calls the Telegram `getMe` method which returns information about the
 * bot itself — useful at startup to confirm the token is valid and to
 * display the bot's `@username`.
 *
 * @param token - Telegram Bot API token
 * @returns Bot info including `id`, `username`, and `first_name`
 *
 * @throws {Error} If the token is invalid or the API is unreachable
 *
 * @example
 * ```ts
 * const bot = await getMe(token);
 * console.log(`Connected as @${bot.username}`);
 * ```
 */
import type { TelegramBotInfo } from '../types';
import { callApi } from './call-api';

export async function getMe(token: string): Promise<TelegramBotInfo> {
    console.log('[Telegram API] Verifying bot token…');
    const info = await callApi<TelegramBotInfo>(token, 'getMe');
    console.log(`[Telegram API] Authenticated as @${info.username} (id: ${info.id})`);
    return info;
}
