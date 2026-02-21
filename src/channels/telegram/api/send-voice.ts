/**
 * Send a voice message to a Telegram chat from a local file path.
 *
 * Reads the file from disk (should be .ogg with Opus) and uploads it
 * as multipart/form-data via the Telegram `sendVoice` endpoint.
 *
 * @param token   - Telegram Bot API token
 * @param chatId  - Target chat / user ID
 * @param filePath - Path to the audio file on disk (.ogg/.mp3)
 * @param caption - Optional caption text
 */
import { readFile } from 'fs/promises';
import { basename } from 'path';

export async function sendVoice(
    token: string,
    chatId: number,
    filePath: string,
    caption?: string,
): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendVoice`;

    let fileData: Buffer;
    try {
        fileData = await readFile(filePath);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Cannot read voice file "${filePath}": ${reason}`);
        throw new Error(`sendVoice: cannot read file "${filePath}" — ${reason}`);
    }

    const fileName = basename(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', new Blob([new Uint8Array(fileData)]), fileName);
    if (caption) form.append('caption', caption);

    let res: Response;
    try {
        res = await fetch(url, { method: 'POST', body: form });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Network error sending voice to ${chatId}: ${reason}`);
        throw new Error(`sendVoice: network error — ${reason}`);
    }

    const data = (await res.json()) as any;
    if (!data.ok) {
        const desc = data.description || 'Unknown error';
        console.error(`[Telegram API] sendVoice failed for chat ${chatId}: ${desc} (${data.error_code})`);
        throw new Error(`Telegram API sendVoice: ${desc} (${data.error_code})`);
    }

    console.log(`[Telegram API] Voice sent to chat ${chatId} (${fileName})`);
}
