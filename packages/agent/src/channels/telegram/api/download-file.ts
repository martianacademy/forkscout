/**
 * Download a file from Telegram's servers by `file_id`.
 *
 * Telegram stores uploaded media with a unique `file_id`. This function:
 * 1. Resolves the `file_id` → a temporary download path via `getFile`
 * 2. Fetches the raw bytes from `https://api.telegram.org/file/bot<token>/<path>`
 * 3. Returns the content as a base64-encoded string + its MIME media type
 *
 * Returns `null` (instead of throwing) when the download fails so callers
 * can gracefully skip missing/expired files.
 *
 * @param token  - Telegram Bot API token
 * @param fileId - The `file_id` from a photo, document, etc.
 * @returns `{ base64, mediaType }` on success, or `null` on failure
 *
 * @example
 * ```ts
 * const photo = await downloadFile(token, message.photo[0].file_id);
 * if (photo) {
 *     console.log(`Downloaded ${photo.mediaType}, ${photo.base64.length} chars`);
 * }
 * ```
 */
import { callApi } from './call-api';

/** Map of common image extensions → MIME types */
const MEDIA_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
};

export async function downloadFile(
    token: string,
    fileId: string,
): Promise<{ base64: string; mediaType: string } | null> {
    try {
        // Step 1 — resolve file_id to a download path
        const fileInfo = await callApi<{
            file_id: string;
            file_path?: string;
            file_size?: number;
        }>(token, 'getFile', { file_id: fileId });

        if (!fileInfo.file_path) {
            console.warn(`[Telegram API] getFile returned no file_path for ${fileId}`);
            return null;
        }

        // Step 2 — fetch the raw bytes
        const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[Telegram API] File download HTTP ${res.status} for ${fileId}`);
            return null;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = fileInfo.file_path.split('.').pop()?.toLowerCase() || 'jpg';

        console.log(
            `[Telegram API] Downloaded file ${fileId} (${buffer.length} bytes, .${ext})`,
        );

        return {
            base64: buffer.toString('base64'),
            mediaType: MEDIA_TYPES[ext] || 'image/jpeg',
        };
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Telegram API] Failed to download file ${fileId}: ${reason}`);
        return null;
    }
}
