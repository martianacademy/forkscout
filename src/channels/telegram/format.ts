// src/channels/telegram/format.ts — Convert LLM markdown to Telegram HTML
//
// Telegram supports a small HTML subset:
//   <b>, <i>, <u>, <s>, <code>, <pre>, <a href="...">, <blockquote>
//
// Strategy: convert the most common LLM markdown patterns to HTML,
// then escape any raw HTML special chars in plain-text segments.

/**
 * Escape characters that have special meaning in Telegram HTML:
 * & → &amp;   < → &lt;   > → &gt;
 * Applied only to plain text, NOT to already-converted HTML tags.
 */
function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert LLM Markdown to Telegram-safe HTML.
 * Handles the most common patterns — not a full spec-compliant parser.
 */
export function mdToHtml(md: string): string {
    let out = md;

    // ── Fenced code blocks (``` lang\n...\n```) ─────────────────────────────
    out = out.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
        `<pre><code>${escapeHtml(code.trim())}</code></pre>`
    );

    // ── Inline code (`...`) ──────────────────────────────────────────────────
    out = out.replace(/`([^`\n]+)`/g, (_, code) =>
        `<code>${escapeHtml(code)}</code>`
    );

    // ── Bold: **text** or __text__ ────────────────────────────────────────────
    out = out.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    out = out.replace(/__(.+?)__/g, "<b>$1</b>");

    // ── Italic: *text* or _text_ (not inside already-replaced patterns) ──────
    out = out.replace(/\*(?!\*)(.+?)(?<!\*)\*/g, "<i>$1</i>");
    out = out.replace(/_(?!_)(.+?)(?<!_)_/g, "<i>$1</i>");

    // ── Strikethrough: ~~text~~ ───────────────────────────────────────────────
    out = out.replace(/~~(.+?)~~/g, "<s>$1</s>");

    // ── Links: [text](url) ────────────────────────────────────────────────────
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');

    // ── Headings: # H1 / ## H2 / ### H3 — make bold ──────────────────────────
    out = out.replace(/^#{1,3} (.+)$/gm, "<b>$1</b>");

    // ── Blockquotes: > text ───────────────────────────────────────────────────
    out = out.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

    // ── Escape remaining & < > that are NOT part of our tags ─────────────────
    // Split on tags we just produced, escape text segments only
    out = out
        .split(/(<[^>]+>)/g)
        .map((seg) => (seg.startsWith("<") ? seg : escapeHtml(seg)))
        .join("");

    return out.trim();
}

/**
 * Strip all HTML tags and decode basic entities back to plain text.
 * Used as fallback when Telegram rejects an HTML message.
 */
export function stripHtml(html: string): string {
    return html
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

/**
 * Telegram has a 4096-char limit per message.
 * Split on paragraph breaks, keeping chunks under the limit.
 */
export function splitMessage(text: string, limit = 4000): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let current = "";

    for (const para of paragraphs) {
        const next = current ? `${current}\n\n${para}` : para;
        if (next.length > limit) {
            if (current) chunks.push(current);
            // If a single paragraph is too long, hard-split it
            if (para.length > limit) {
                for (let i = 0; i < para.length; i += limit) {
                    chunks.push(para.slice(i, i + limit));
                }
                current = "";
            } else {
                current = para;
            }
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}
