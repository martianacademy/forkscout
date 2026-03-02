// src/channels/whatsapp/utils.ts — Shared WhatsApp channel utilities

/** Async sleep. */
export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Strip non-digit characters from a phone number.
 * Result is E.164 format without the leading +.
 * Example: "+1 (234) 567-8901" → "12345678901"
 */
export function sanitizePhoneNumber(input: string): string {
    return input.replace(/[^0-9]/g, "");
}

/**
 * Split text into chunks at paragraph or sentence boundaries.
 * Used to stay under WhatsApp's per-message character limits.
 */
export function splitText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        // Try to split at double newline
        let splitIdx = remaining.lastIndexOf("\n\n", maxLen);
        if (splitIdx < maxLen * 0.3) {
            // Try single newline
            splitIdx = remaining.lastIndexOf("\n", maxLen);
        }
        if (splitIdx < maxLen * 0.3) {
            // Try sentence boundary
            splitIdx = remaining.lastIndexOf(". ", maxLen);
            if (splitIdx > 0) splitIdx += 1;
        }
        if (splitIdx < maxLen * 0.3) {
            splitIdx = remaining.lastIndexOf(" ", maxLen);
        }
        if (splitIdx < 1) {
            splitIdx = maxLen;
        }

        chunks.push(remaining.slice(0, splitIdx).trimEnd());
        remaining = remaining.slice(splitIdx).trimStart();
    }

    return chunks;
}
