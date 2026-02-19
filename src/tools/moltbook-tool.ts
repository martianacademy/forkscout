/**
 * Moltbook social platform tools — post, comment, upvote, browse, verify.
 *
 * API base: https://www.moltbook.com/api/v1
 * Auth: Bearer token from MOLTBOOK_API_KEY env var.
 * Posts/comments require solving an obfuscated math captcha within 5 minutes.
 */

import { tool } from 'ai';
import { z } from 'zod';

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';

// ── Captcha solver ──────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, thre: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, twelv: 12, thirteen: 13, thirten: 13,
    fourteen: 14, fourten: 14, fifteen: 15, fiften: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, nineten: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

const COMPOUND_NUMBERS: Record<string, number> = {};
for (const [tensWord, tensVal] of Object.entries(NUMBER_WORDS)) {
    if (tensVal >= 20 && tensVal <= 90 && tensVal % 10 === 0) {
        for (const [unitWord, unitVal] of Object.entries(NUMBER_WORDS)) {
            if (unitVal >= 1 && unitVal <= 9) {
                COMPOUND_NUMBERS[`${tensWord}${unitWord}`] = tensVal + unitVal;
            }
        }
    }
}

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'and', 'or', 'but', 'if', 'of', 'at',
    'to', 'in', 'on', 'for', 'by', 'it', 'its', 'um', 'uh', 'er', 'how', 'what',
    'whats', 'that', 'this', 'much', 'many', 'new', 'per', 'she', 'he', 'her', 'his',
    'lobster', 'lobsters', 'claw', 'claws', 'newton', 'newtons', 'noton', 'notons',
    'neoton', 'neotons', 'neuton', 'neutons', 'meter', 'meters', 'second', 'seconds',
    'force', 'total', 'speed', 'velocity', 'molting', 'antena', 'antenna', 'touches',
    'exert', 'exerts', 'aplies', 'applies', 'swims', 'gains', 'gives', 'ads', 'adds',
    'another', 'other', 'craw', 'dobles', 'doubles', 'centimeter', 'centimeters',
    'suddenly', 'sudenly', 'minute', 'current', 'product', 'sped', 'swim',
]);

function editDistance(a: string, b: string): number {
    const n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= n; j++) {
            curr[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
        }
        prev = curr;
    }
    return prev[n];
}

function fuzzyMatch(word: string, dict: Record<string, number>, maxDist = 2): number | null {
    if (dict[word] !== undefined) return dict[word];
    let bestVal: number | null = null;
    let bestDist = maxDist + 1;
    for (const [key, val] of Object.entries(dict)) {
        if (Math.abs(key.length - word.length) > maxDist) continue;
        const d = editDistance(word, key);
        if (d < bestDist) { bestDist = d; bestVal = val; }
    }
    return bestVal;
}

function fuzzyStopWord(word: string): boolean {
    if (STOP_WORDS.has(word)) return true;
    for (const sw of STOP_WORDS) {
        if (Math.abs(sw.length - word.length) <= 1 && editDistance(word, sw) <= 1) return true;
    }
    return false;
}

function dedup(s: string): string {
    let out = '';
    for (const ch of s) {
        if (out.length === 0 || ch !== out[out.length - 1]) out += ch;
    }
    return out;
}

function joinFragments(tokens: string[]): string[] {
    const result: string[] = [];
    let i = 0;
    while (i < tokens.length) {
        let joined = tokens[i];
        let bestLen = 1;
        for (let j = 1; j <= Math.min(5, tokens.length - i - 1); j++) {
            joined += tokens[i + j];
            if (NUMBER_WORDS[joined] !== undefined || COMPOUND_NUMBERS[joined] !== undefined || STOP_WORDS.has(joined)) {
                bestLen = j + 1;
            }
        }
        if (bestLen > 1) {
            let r = tokens[i];
            for (let j = 1; j < bestLen; j++) r += tokens[i + j];
            result.push(r);
            i += bestLen;
        } else {
            result.push(tokens[i]);
            i++;
        }
    }
    return result;
}

function solveChallenge(raw: string): string | null {
    const text = raw.toLowerCase().replace(/[^a-z ]/g, ' ');
    const tokens = text.split(/\s+/).filter(Boolean).map(dedup);
    const joined = joinFragments(tokens);

    const numbers: number[] = [];
    for (const word of joined) {
        const compVal = COMPOUND_NUMBERS[word];
        if (compVal !== undefined) { numbers.push(compVal); continue; }
        const numVal = NUMBER_WORDS[word];
        if (numVal !== undefined) { numbers.push(numVal); continue; }
        const fuzzyComp = fuzzyMatch(word, COMPOUND_NUMBERS);
        if (fuzzyComp !== null) { numbers.push(fuzzyComp); continue; }
        const fuzzyNum = fuzzyMatch(word, NUMBER_WORDS);
        if (fuzzyNum !== null && !fuzzyStopWord(word)) { numbers.push(fuzzyNum); continue; }
    }

    if (numbers.length < 2) return null;

    // Collapse tens+units (e.g. [20, 3] → [23])
    const collapsed: number[] = [];
    for (let i = 0; i < numbers.length; i++) {
        const n = numbers[i];
        if (n >= 20 && n <= 90 && n % 10 === 0 && i + 1 < numbers.length) {
            const next = numbers[i + 1];
            if (next >= 1 && next <= 9) { collapsed.push(n + next); i++; continue; }
        }
        collapsed.push(n);
    }

    const lowerRaw = raw.toLowerCase();
    let op: 'add' | 'subtract' | 'multiply' | 'divide' = 'add';
    if (/product|multipl|\*|times/.test(lowerRaw)) op = 'multiply';
    else if (/subtract|minus|less|differ|slow/.test(lowerRaw)) op = 'subtract';
    else if (/divid|ratio|split/.test(lowerRaw)) op = 'divide';

    const [a, b] = collapsed;
    let answer: number;
    switch (op) {
        case 'add': answer = a + b; break;
        case 'subtract': answer = a - b; break;
        case 'multiply': answer = a * b; break;
        case 'divide': answer = b !== 0 ? a / b : 0; break;
    }
    return answer.toFixed(2);
}

// ── API helper ──────────────────────────────────────────

interface MoltbookResponse {
    success?: boolean;
    message?: string;
    [key: string]: unknown;
}

async function moltbookFetch(
    method: string,
    path: string,
    body?: Record<string, unknown>,
): Promise<MoltbookResponse> {
    const apiKey = process.env.MOLTBOOK_API_KEY_FORKSCOUT;
    if (!apiKey) throw new Error('MOLTBOOK_API_KEY_FORKSCOUT not set in environment');

    const url = `${MOLTBOOK_API_BASE}${path}`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    return await res.json() as MoltbookResponse;
}

async function tryVerify(verification: { verification_code: string; challenge_text: string }): Promise<boolean> {
    const answer = solveChallenge(verification.challenge_text);
    if (!answer) return false;
    const result = await moltbookFetch('POST', '/verify', {
        verification_code: verification.verification_code,
        answer,
    });
    return result.success === true;
}

// ── Tool definitions ────────────────────────────────────

export function createMoltbookTools() {
    return {
        moltbook_create_post: tool({
            description:
                'Create a new post on Moltbook (social network for AI agents). ' +
                'Requires title, content, and submolt (default "general"). ' +
                'Auto-verifies captcha (up to 3 retries). 2-hour cooldown between posts for new agents.',
            inputSchema: z.object({
                title: z.string().describe('Post title'),
                content: z.string().describe('Post body (markdown supported)'),
                submolt: z.string().default('general').describe('Submolt to post in'),
            }),
            execute: async ({ title, content, submolt }: { title: string; content: string; submolt: string }) => {
                for (let attempt = 0; attempt < 3; attempt++) {
                    const result = await moltbookFetch('POST', '/posts', { submolt_name: submolt, title, content });
                    if (!result.success) {
                        return { success: false, error: result.message || JSON.stringify(result), retry_after_minutes: result.retry_after_minutes };
                    }
                    const post = result.post as Record<string, any> | undefined;
                    const postId = post?.id;
                    const verification = post?.verification;
                    if (!verification) return { success: true, post_id: postId, message: 'Post published' };
                    if (await tryVerify(verification)) return { success: true, post_id: postId, message: 'Post verified and live!' };
                    if (postId) await moltbookFetch('DELETE', `/posts/${postId}`);
                }
                return { success: false, error: 'Captcha verification failed after 3 attempts' };
            },
        }),

        moltbook_comment: tool({
            description:
                'Comment on a Moltbook post. Auto-verifies captcha. 60-second cooldown for new agents.',
            inputSchema: z.object({
                post_id: z.string().describe('The post ID to comment on'),
                content: z.string().describe('Comment text'),
            }),
            execute: async ({ post_id, content }: { post_id: string; content: string }) => {
                for (let attempt = 0; attempt < 3; attempt++) {
                    const result = await moltbookFetch('POST', `/posts/${post_id}/comments`, { content });
                    if (!result.success) return { success: false, error: result.message || JSON.stringify(result) };
                    const comment = result.comment as Record<string, any> | undefined;
                    const commentId = comment?.id;
                    const verification = comment?.verification;
                    if (!verification) return { success: true, comment_id: commentId, message: 'Comment published' };
                    if (await tryVerify(verification)) return { success: true, comment_id: commentId, message: 'Comment verified and live!' };
                    if (commentId) await moltbookFetch('DELETE', `/posts/${post_id}/comments/${commentId}`);
                }
                return { success: false, error: 'Captcha verification failed after 3 attempts' };
            },
        }),

        moltbook_upvote: tool({
            description: 'Upvote a post on Moltbook',
            inputSchema: z.object({
                post_id: z.string().describe('The post ID to upvote'),
            }),
            execute: async ({ post_id }: { post_id: string }) => {
                const result = await moltbookFetch('POST', `/posts/${post_id}/upvote`, {});
                return { success: result.success !== false, message: result.message || 'Upvoted' };
            },
        }),

        moltbook_downvote: tool({
            description: 'Downvote a post on Moltbook',
            inputSchema: z.object({
                post_id: z.string().describe('The post ID to downvote'),
            }),
            execute: async ({ post_id }: { post_id: string }) => {
                const result = await moltbookFetch('POST', `/posts/${post_id}/downvote`, {});
                return { success: result.success !== false, message: result.message || 'Downvoted' };
            },
        }),

        moltbook_get_feed: tool({
            description: 'Browse the Moltbook feed. Returns posts sorted by hot/new/top.',
            inputSchema: z.object({
                sort: z.enum(['hot', 'new', 'top']).default('hot').describe('Sort order'),
                limit: z.number().default(10).describe('Number of posts (max 25)'),
                submolt: z.string().default('general').describe('Submolt to browse'),
            }),
            execute: async ({ sort, limit, submolt }: { sort: string; limit: number; submolt: string }) => {
                const result = await moltbookFetch('GET', `/posts?submolt=${submolt}&sort=${sort}&limit=${Math.min(limit, 25)}`);
                if (!result.success) return { success: false, error: result.message || JSON.stringify(result) };
                const posts = (result.posts as any[]) || [];
                return {
                    success: true,
                    count: posts.length,
                    posts: posts.map((p: any) => ({
                        id: p.id, title: p.title, author: p.author?.name,
                        score: p.score, comment_count: p.comment_count,
                        created_at: p.created_at,
                        content_preview: typeof p.content === 'string' ? p.content.slice(0, 200) : '',
                    })),
                };
            },
        }),

        moltbook_get_comments: tool({
            description: 'Get comments on a Moltbook post',
            inputSchema: z.object({
                post_id: z.string().describe('The post ID'),
                sort: z.enum(['hot', 'new', 'top']).default('new').describe('Sort order'),
                limit: z.number().default(10).describe('Number of comments'),
            }),
            execute: async ({ post_id, sort, limit }: { post_id: string; sort: string; limit: number }) => {
                const result = await moltbookFetch('GET', `/posts/${post_id}/comments?sort=${sort}&limit=${limit}`);
                if (!result.success) return { success: false, error: result.message || JSON.stringify(result) };
                const comments = (result.comments as any[]) || [];
                return {
                    success: true,
                    count: comments.length,
                    comments: comments.map((c: any) => ({
                        id: c.id, author: c.author?.name, content: c.content,
                        score: c.score, created_at: c.created_at,
                    })),
                };
            },
        }),

        moltbook_my_profile: tool({
            description: 'Get current Moltbook agent profile (karma, posts, followers)',
            inputSchema: z.object({}),
            execute: async () => {
                const result = await moltbookFetch('GET', '/agents/me');
                if (!result.success) return { success: false, error: result.message || JSON.stringify(result) };
                const a = result.agent as Record<string, any>;
                return {
                    success: true, name: a?.name, karma: a?.karma,
                    posts_count: a?.posts_count, comments_count: a?.comments_count,
                    follower_count: a?.follower_count, following_count: a?.following_count,
                    is_verified: a?.is_verified, created_at: a?.created_at,
                };
            },
        }),
    };
}