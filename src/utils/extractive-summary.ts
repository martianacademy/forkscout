/**
 * src/utils/extractive-summary.ts
 *
 * Pure extractive summarization — no LLM, no network.
 *
 * Algorithm:
 *   1. Split content into sentences
 *   2. Score each sentence by the sum of non-stopword term frequencies
 *   3. Pick top-N highest-scoring sentences in their original order
 *   4. Return joined with " ... "
 *
 * Suitable for compressing web pages, shell output, search results, file reads.
 */

const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
    "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall",
    "that", "this", "these", "those", "it", "its", "not", "no", "as", "if", "so", "than",
    "then", "when", "where", "which", "who", "what", "how", "i", "we", "you", "he", "she",
    "they", "my", "your", "his", "her", "our", "their", "me", "him", "us", "them",
]);

/** Sentence boundary — split on . ! ? followed by whitespace or end of string */
function splitSentences(text: string): string[] {
    return text
        .replace(/\r\n/g, "\n")
        .split(/(?<=[.!?])\s+|\n{2,}/)
        .map(s => s.trim())
        .filter(s => s.length > 20); // ignore fragments
}

/** Tokenise a sentence into lowercase, alpha-only words */
function tokenise(text: string): string[] {
    return text.toLowerCase().match(/[a-z]+/g)?.filter(w => !STOPWORDS.has(w)) ?? [];
}

/** Build a term-frequency map across ALL sentences */
function buildTermFreq(sentences: string[]): Map<string, number> {
    const freq = new Map<string, number>();
    for (const s of sentences) {
        for (const word of tokenise(s)) {
            freq.set(word, (freq.get(word) ?? 0) + 1);
        }
    }
    return freq;
}

/** Score a sentence: sum of TF of its non-stopword terms, normalised by length */
function scoreSentence(sentence: string, freq: Map<string, number>): number {
    const words = tokenise(sentence);
    if (words.length === 0) return 0;
    const total = words.reduce((sum, w) => sum + (freq.get(w) ?? 0), 0);
    return total / words.length;
}

export interface SummaryOptions {
    /** Target number of sentences to keep. Default: 8 */
    maxSentences?: number;
    /** If true, append a note showing original vs summary sentence count. Default: true */
    addNote?: boolean;
}

/**
 * Summarise text extractively.
 * Returns the top-N most informative sentences in original order.
 *
 * @example
 * const short = extractiveSummary(hugeWebPage, { maxSentences: 6 });
 */
export function extractiveSummary(text: string, opts: SummaryOptions = {}): string {
    const { maxSentences = 8, addNote = true } = opts;

    const sentences = splitSentences(text);
    if (sentences.length <= maxSentences) return text; // already short enough

    const freq = buildTermFreq(sentences);
    const scored = sentences.map((s, i) => ({ s, i, score: scoreSentence(s, freq) }));

    // Pick top-N by score, restore original order
    const top = scored
        .slice() // don't mutate
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences)
        .sort((a, b) => a.i - b.i)
        .map(x => x.s);

    const result = top.join(" ... ");
    if (!addNote) return result;
    return `${result}\n\n[summarised: ${sentences.length} → ${top.length} sentences]`;
}

/**
 * Utility: compress a string if it exceeds maxChars, otherwise return as-is.
 * Used in tool result capping — avoids encoding overhead when content is already small.
 */
export function compressIfLong(text: string, maxChars: number, maxSentences = 8): string {
    if (text.length <= maxChars) return text;
    return extractiveSummary(text, { maxSentences });
}
