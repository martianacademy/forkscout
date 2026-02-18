/**
 * Sanitize standard (GitHub-flavored) Markdown into Telegram-safe Markdown.
 *
 * ## The problem
 * LLMs emit standard Markdown: `**bold**`, `### Headers`, `> quotes`, `---`,
 * `~~strikethrough~~`, nested lists with `*`, etc.
 * Telegrams legacy `Markdown` parse_mode only supports:
 *   *bold*   _italic_   `code`   ```pre```   [text](url)
 *
 * Anything else causes "can't parse entities" errors (400).
 *
 * ## What this does
 * 1. Protects code blocks and inline code (leave them untouched)
 * 2. Converts `**text**` → `*text*`  (bold)
 * 3. Converts `__text__` → `_text_`  (italic)
 * 4. Strips `~~text~~` → `text`      (no strikethrough in legacy)
 * 5. Strips `# Header` → `*Header*`  (bold as header substitute)
 * 6. Strips `> blockquote` → `blockquote`
 * 7. Strips `---` / `***` horizontal rules
 * 8. Validates that all `*`, `_`, `` ` `` markers are balanced;
 *    strips orphaned markers to prevent parse errors.
 *
 * @module channels/telegram/api/sanitize-markdown
 */

// ── Placeholder system ─────────────────────────────────
// We temporarily replace code blocks/inline code with placeholders
// so the rest of the transforms don't corrupt them.

const PH_PREFIX = '\x00CB'; // code block placeholder
const PH_INLINE = '\x00CI'; // inline code placeholder

interface ProtectedBlock {
    placeholder: string;
    original: string;
}

function protectCodeBlocks(text: string): { text: string; blocks: ProtectedBlock[] } {
    const blocks: ProtectedBlock[] = [];
    let idx = 0;

    // Protect fenced code blocks (```...```)
    let result = text.replace(/```[\s\S]*?```/g, (match) => {
        const ph = `${PH_PREFIX}${idx++}\x00`;
        blocks.push({ placeholder: ph, original: match });
        return ph;
    });

    // Protect inline code (`...`)
    result = result.replace(/`[^`\n]+`/g, (match) => {
        const ph = `${PH_INLINE}${idx++}\x00`;
        blocks.push({ placeholder: ph, original: match });
        return ph;
    });

    return { text: result, blocks };
}

function restoreCodeBlocks(text: string, blocks: ProtectedBlock[]): string {
    let result = text;
    for (const b of blocks) {
        result = result.replace(b.placeholder, b.original);
    }
    return result;
}

// ── Core transforms ────────────────────────────────────

/**
 * Convert standard Markdown → Telegram legacy Markdown.
 *
 * Safe to call on any text — if it's already Telegram-compatible,
 * it passes through unchanged.
 */
export function sanitizeTelegramMarkdown(text: string): string {
    // Step 1: Protect code blocks from munging
    const { text: working, blocks } = protectCodeBlocks(text);

    let result = working;

    // Step 2: Convert **bold** → *bold*  (must come before single * handling)
    result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

    // Step 3: Convert __italic__ → _italic_
    result = result.replace(/__(.+?)__/g, '_$1_');

    // Step 4: Strip ~~strikethrough~~ → just text
    result = result.replace(/~~(.+?)~~/g, '$1');

    // Step 5: Convert markdown headers → bold text
    // `### Header text` → `*Header text*`
    result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // Step 6: Strip blockquote markers
    result = result.replace(/^>\s?/gm, '');

    // Step 7: Strip horizontal rules
    result = result.replace(/^[-*_]{3,}\s*$/gm, '');

    // Step 8: Clean up image references ![alt](url) → alt (url)
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)');

    // Step 9: Validate paired markers — strip orphaned ones
    result = ensureBalancedMarkers(result);

    // Step 10: Restore code blocks
    result = restoreCodeBlocks(result, blocks);

    // Step 11: Clean up excessive blank lines (3+ → 2)
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
}

// ── Marker balancing ───────────────────────────────────

/**
 * Ensure `*`, `_` markers appear in balanced pairs.
 * If a marker is orphaned (odd count), strip all instances of that marker
 * rather than risk a parse error.
 *
 * This is deliberately conservative: we only strip the problematic marker type,
 * not all formatting.
 */
function ensureBalancedMarkers(text: string): string {
    let result = text;

    // Check each marker type independently
    for (const marker of ['*', '_']) {
        // Count occurrences not inside a placeholder
        const escaped = marker === '*' ? '\\*' : '_';
        const regex = new RegExp(escaped, 'g');
        const matches = result.match(regex);
        const count = matches ? matches.length : 0;

        if (count % 2 !== 0) {
            // Odd count → there's an orphaned marker somewhere
            // Strategy: try to find the orphan by scanning for unpaired markers
            // Fall back: strip all markers of this type
            result = stripOrphanedMarker(result, marker);
        }
    }

    // Check for unmatched [ without ](
    // Telegram Markdown requires [text](url) — a solo [ triggers parse error
    result = fixBrokenLinks(result);

    return result;
}

/**
 * Try to find and strip just the orphaned marker.
 * If we can't isolate it, strip all markers of that type.
 */
function stripOrphanedMarker(text: string, marker: string): string {
    // Simple approach: scan through, pair up markers, remove the last unpaired one
    const parts: number[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === marker) {
            parts.push(i);
        }
    }

    if (parts.length % 2 === 0) return text; // already balanced

    // Remove the last orphaned marker (most likely culprit — often at end of message)
    const orphanIdx = parts[parts.length - 1];
    return text.slice(0, orphanIdx) + text.slice(orphanIdx + 1);
}

/**
 * Fix broken link syntax — `[text]` without `(url)` triggers parse errors.
 * Convert orphaned `[text]` → `text`.
 */
function fixBrokenLinks(text: string): string {
    // Valid: [text](url)  — keep these
    // Broken: [text] without (url) — strip brackets
    // Approach: replace [ that aren't followed eventually by ](
    return text.replace(/\[([^\]]*)\](?!\()/g, '$1');
}
