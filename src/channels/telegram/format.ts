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
    // Only allow the Telegram HTML subset — anything else gets escaped.
    // This prevents unknown tags like <minimax:tool_call> from breaking the parser.
    const TELEGRAM_TAG_RE = /^<\/?(b|strong|i|em|u|ins|s|strike|del|code|pre|a|blockquote|tg-spoiler|span)(\s[^>]*)?>$/i;
    out = out
        .split(/(<[^>]+>)/g)
        .map((seg) => (seg.startsWith("<") && TELEGRAM_TAG_RE.test(seg) ? seg : escapeHtml(seg)))
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
 * Split raw Markdown into chunks under `limit` chars.
 *
 * Fenced code blocks (``` ... ```) are treated as atomic units and are never
 * split mid-block, which avoids producing unbalanced <pre><code> tags when
 * each chunk is later passed through mdToHtml().
 *
 * Usage pattern:
 *   const chunks = splitMarkdown(rawText).map(mdToHtml);
 *
 * Replaces the old splitMessage(html) pattern which split post-conversion and
 * could bisect HTML tags, producing "Unexpected end tag" errors in Telegram.
 */
export function splitMarkdown(md: string, limit = 4000): string[] {
    if (md.length <= limit) return [md];

    // Tokenize: fenced code blocks are "atomic" (unsplittable), everything else is "splittable"
    const tokens: { text: string; atomic: boolean }[] = [];
    const fenceRe = /```[\w]*\n[\s\S]*?```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    fenceRe.lastIndex = 0;
    while ((match = fenceRe.exec(md)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ text: md.slice(lastIndex, match.index), atomic: false });
        }
        tokens.push({ text: match[0], atomic: true });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < md.length) {
        tokens.push({ text: md.slice(lastIndex), atomic: false });
    }

    const chunks: string[] = [];
    let current = "";

    const pushChunk = (s: string) => { if (s.trim()) chunks.push(s.trim()); };
    const appendToCurrent = (s: string) => {
        current = current ? `${current}\n\n${s}` : s;
    };

    for (const tok of tokens) {
        if (tok.atomic) {
            // Atomic block: try to fit in current chunk; otherwise flush and start fresh
            if (current && current.length + 2 + tok.text.length > limit) {
                pushChunk(current);
                current = "";
            }
            if (tok.text.length > limit) {
                // Oversized code block: hard-split (rare, accepts degraded formatting)
                if (current) { pushChunk(current); current = ""; }
                for (let i = 0; i < tok.text.length; i += limit) {
                    pushChunk(tok.text.slice(i, i + limit));
                }
            } else {
                appendToCurrent(tok.text);
            }
        } else {
            // Non-atomic prose: split on blank lines
            const paragraphs = tok.text.split(/\n\n+/);
            for (const para of paragraphs) {
                if (!para.trim()) continue;
                const next = current ? `${current}\n\n${para}` : para;
                if (next.length > limit) {
                    if (current) { pushChunk(current); current = ""; }
                    if (para.length > limit) {
                        for (let i = 0; i < para.length; i += limit) {
                            pushChunk(para.slice(i, i + limit));
                        }
                    } else {
                        current = para;
                    }
                } else {
                    current = next;
                }
            }
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [md];
}

/**
 * @deprecated Use splitMarkdown(text).map(mdToHtml) instead.
 * Splits already-converted HTML, which can bisect tags inside <pre> blocks.
 * Kept for any callers that haven't been migrated yet.
 */
export function splitMessage(text: string, limit = 4000): string[] {
    return splitMarkdown(text, limit);
}
