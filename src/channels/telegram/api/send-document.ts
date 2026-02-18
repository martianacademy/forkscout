/**
 * Send a document / file to a Telegram chat from a local file path.
 *
 * Reads the file from disk and uploads it as multipart/form-data via
 * the Telegram `sendDocument` endpoint. Works for any file type — PDFs,
 * ZIPs, logs, etc.
 *
 * @param token    - Telegram Bot API token
 * @param chatId   - Target chat / user ID
 * @param filePath - Absolute or relative path to the file on disk
 * @param caption  - Optional caption text (supports Markdown)
 *
 * @throws {Error} If the file cannot be read or the API rejects the upload
 *
 * @example
 * ```ts
 * await sendDocument(token, chatId, '/tmp/report.pdf', 'Daily report');
 * ```
 */
import { readFile } from 'fs/promises';
import { basename } from 'path';

export async function sendDocument(
    token: string,
    chatId: number,
    filePath: string,
    caption?: string,
): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendDocument`;

    let fileData: Buffer;
    try {
        fileData = await readFile(filePath);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Cannot read document file "${filePath}": ${reason}`);
        throw new Error(`sendDocument: cannot read file "${filePath}" — ${reason}`);
    }

    const fileName = basename(filePath);
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([new Uint8Array(fileData)]), fileName);
    if (caption) form.append('caption', caption);

    let res: Response;
    try {
        res = await fetch(url, { method: 'POST', body: form });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Network error sending document to ${chatId}: ${reason}`);
        throw new Error(`sendDocument: network error — ${reason}`);
    }

    const data = (await res.json()) as any;
    if (!data.ok) {
        const desc = data.description || 'Unknown error';
        console.error(`[Telegram API] sendDocument failed for chat ${chatId}: ${desc} (${data.error_code})`);
        throw new Error(`Telegram API sendDocument: ${desc} (${data.error_code})`);
    }

    console.log(`[Telegram API] Document sent to chat ${chatId} (${fileName})`);
}
