/**
 * Enhanced RAG helpers — chunking, query expansion, session summarization.
 *
 * @module memory/manager/rag
 */

import type { VectorStore } from '../vector-store';

/**
 * Split long text into overlapping chunks for better retrieval.
 * Tries to break at sentence or paragraph boundaries.
 */
export function chunkText(text: string, maxSize = 1500, overlap = 200): string[] {
    if (text.length <= maxSize) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
        let end = start + maxSize;

        // Try to break at a sentence boundary
        if (end < text.length) {
            const breakPoints = ['. ', '.\n', '\n\n', '\n', '; ', ', '];
            for (const bp of breakPoints) {
                const breakAt = text.lastIndexOf(bp, end);
                if (breakAt > start + maxSize * 0.5) {
                    end = breakAt + bp.length;
                    break;
                }
            }
        }

        chunks.push(text.slice(start, end));
        start = end - overlap;

        if (text.length - start < overlap) {
            if (chunks.length > 0) {
                chunks[chunks.length - 1] = text.slice(start - (end - start) + overlap);
            }
            break;
        }
    }

    return chunks;
}

/**
 * Summarize current session exchanges into a compressed summary chunk.
 * Requires a summarizer callback. Stores the summary in the vector store.
 */
export async function summarizeCurrentSession(
    vectorStore: VectorStore,
    sessionId: string,
    summarizer: (text: string) => Promise<string>,
): Promise<void> {
    const sessionChunks = vectorStore.getSession(sessionId)
        .filter(c => c.type === 'exchange');

    if (sessionChunks.length < 3) return;

    const exchangeText = sessionChunks
        .map(c => c.text)
        .join('\n---\n')
        .slice(0, 3000);

    try {
        const summary = await summarizer(exchangeText);
        await vectorStore.add({
            id: `summary_${sessionId}`,
            text: `[Session summary]: ${summary}`,
            summary,
            timestamp: Date.now(),
            sessionId,
            type: 'summary',
        });
        console.log(`📋 Session summary saved (${sessionChunks.length} exchanges → 1 summary)`);
    } catch {
        // Summarization failed — raw exchanges are still there
    }
}
