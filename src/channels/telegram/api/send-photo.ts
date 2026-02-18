/**
 * Send a photo to a Telegram chat from a local file path.
 *
 * Reads the file from disk and uploads it as multipart/form-data via
 * the Telegram `sendPhoto` endpoint.
 *
 * @param token   - Telegram Bot API token
 * @param chatId  - Target chat / user ID
 * @param filePath - Absolute or relative path to the image file on disk
 * @param caption - Optional caption text (supports Markdown)
 *
 * @throws {Error} If the file cannot be read or the API rejects the upload
 *
 * @example
 * ```ts
 * await sendPhoto(token, chatId, '/tmp/screenshot.png', 'Here is your screenshot');
 * ```
 */
import { readFile } from 'fs/promises';
import { basename } from 'path';

export async function sendPhoto(
    token: string,
    chatId: number,
    filePath: string,
    caption?: string,
): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendPhoto`;

    let fileData: Buffer;
    try {
        fileData = await readFile(filePath);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Cannot read photo file "${filePath}": ${reason}`);
        throw new Error(`sendPhoto: cannot read file "${filePath}" — ${reason}`);
    }

    const fileName = basename(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', new Blob([new Uint8Array(fileData)]), fileName);
    if (caption) form.append('caption', caption);

    let res: Response;
    try {
        res = await fetch(url, { method: 'POST', body: form });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Network error sending photo to ${chatId}: ${reason}`);
        throw new Error(`sendPhoto: network error — ${reason}`);
    }

    const data = (await res.json()) as any;
    if (!data.ok) {
        const desc = data.description || 'Unknown error';
        console.error(`[Telegram API] sendPhoto failed for chat ${chatId}: ${desc} (${data.error_code})`);
        throw new Error(`Telegram API sendPhoto: ${desc} (${data.error_code})`);
    }

    console.log(`[Telegram API] Photo sent to chat ${chatId} (${fileName})`);
}
