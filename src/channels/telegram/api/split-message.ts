/**
 * Split a long text message at natural boundaries.
 *
 * Telegram limits messages to 4 096 characters. This utility splits
 * longer text at the best available break point:
 *   1. Double newline (`\n\n`) — paragraph break
 *   2. Single newline (`\n`)   — line break
 *   3. Period + space (`. `)   — sentence break
 *   4. Hard cut at `maxLen`    — last resort
 *
 * Each chunk is trimmed so there are no leading/trailing blank lines.
 *
 * @param text   - The message text to split
 * @param maxLen - Maximum length per chunk (default: 4 096)
 * @returns Array of string chunks, each ≤ `maxLen` characters
 *
 * @example
 * ```ts
 * const chunks = splitMessage(longReport);
 * // chunks.length >= 1, each chunk.length <= 4096
 * for (const chunk of chunks) await sendRaw(chunk);
 * ```
 */
export function splitMessage(text: string, maxLen = 4096): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        // Find the best split point within maxLen
        let splitAt = remaining.lastIndexOf('\n\n', maxLen);
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
        if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('. ', maxLen);
        if (splitAt < maxLen * 0.3) splitAt = maxLen; // hard cut

        chunks.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
}
