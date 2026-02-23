/**
 * Pre-flight Acknowledgment — instant "I'm on it" response before the agent starts working.
 *
 * Fires a fast LLM call (classify tier) to produce a short, personality-matched
 * acknowledgment. Sent immediately to Telegram so the user knows the agent heard
 * them, while the main ToolLoopAgent generation runs in parallel.
 *
 * Cost: ~20–40 tokens on the fast tier (fractions of a cent).
 * Latency: ~200–500ms (fast model, short prompt, short output).
 *
 * @module channels/telegram/preflight
 */

import { generateText } from 'ai';
import type { ModelRouter } from '../../llm/router';
import { getConfig } from '../../config';

// ── Skip patterns ──────────────────────────────────────
// Don't ack messages that are so simple the agent will reply instantly anyway.
const SKIP_PATTERNS = [
    /^(hi|hey|hello|yo|sup|hola|namaste|ok|yes|no|thanks|thx|ty|k|lol|haha|hmm|wow|ayo|oye|bhai|bro|dude)[\s!?.]*$/i,
    /^(hi|hey|hello|yo|sup)\s+(there|bro|bhai|buddy|dude|man|sir|boss|ji|yaar)[\s!?.]*$/i,
    /^(kya|kaise|kaisa)\s+(haal|ho|hai|chal).*$/i,           // Hindi greetings
    /^(what'?s?\s*up|how'?s?\s*it\s*going|how\s*are\s*you).*$/i, // English greetings
    /^(good\s*(morning|evening|night|afternoon))[\s!?.]*$/i,
    /^.{0,8}$/,         // Very short messages (< 8 chars)
    /^[\p{Emoji}\s]+$/u, // Emoji-only messages
];

/**
 * Generate a quick pre-flight acknowledgment for the user's message.
 *
 * @param userMessage - The user's message text (or media description like "Photo")
 * @param router      - Model router for tier selection
 * @param hasMedia    - True if the message contains a photo, video, document, voice, etc.
 *                      When true, skip patterns are bypassed so media messages always get an ack.
 * @returns A short ack string, or null if the message doesn't need one.
 */
export async function generatePreflightAck(
    userMessage: string,
    router: ModelRouter,
    hasMedia = false,
): Promise<string | null> {
    // Skip for trivial messages — UNLESS the message contains media.
    // A photo/voice/doc with no text would match the short-text skip pattern ("Photo" = 5 chars),
    // but the user DOES expect a response, so we must not skip it.
    if (!hasMedia && SKIP_PATTERNS.some(p => p.test(userMessage.trim()))) {
        return null;
    }

    try {
        const { model } = router.getModelByTier('fast');
        const cfg = getConfig();
        const name = cfg.agent.appName || 'ForkScout';

        // Build a context hint for media messages so the ack feels relevant
        const mediaHint = hasMedia
            ? '\nThe user sent a media file (photo/video/document/voice). Acknowledge that you received it and will look at it.'
            : '';

        const result = await generateText({
            model,
            system: `You are ${name}, a smart AI assistant on Telegram. The user just sent you a message. Write a VERY brief, warm acknowledgment (1-2 short sentences MAX) that:
1. Shows you received and understood their message
2. Conveys you are NOW working on it
3. Does NOT predict, promise, or describe what the answer will be — you don't know yet
4. Feels like a friend texting back naturally, not a robot
${mediaHint}
Use the SAME language the user writes in. If they write in Hindi/Hinglish, reply in that. If English, reply in English.
Be warm and casual. NO markdown. NO bullet points. NO formal structure.

CRITICAL RULE: NEVER say what you will find, what the answer might be, or what actions you'll take. Just acknowledge receipt and say you're on it. The real answer comes next.

Good examples:
- "On it! 🔍"
- "Hmm, let me think about this..."
- "Got it, give me a sec 👀"
- "Haan haan, ek second..."
- "Interesting — working on it!"
- "Photo mil gayi! Let me take a look 👀"
- "Got your file — checking it out now!"
- "Soch rahi hoon... ek second 🤔"

BAD examples (these predict the answer — FORBIDDEN):
- "Let me search for that!"
- "I'll check the latest news on X"
- "I'll look up the price of Y"
- "Let me dig into that real quick"
- "I know a bit about this — let me pull up details"`,
            prompt: userMessage.slice(0, 300),
            temperature: 0.8,
            maxOutputTokens: 40,
        });

        const ack = result.text?.trim();
        // Safety: skip if the model produced something too long or empty
        if (!ack || ack.length > 200) return null;

        console.log(`[Preflight ack]: "${ack}"`);
        return ack;
    } catch (err) {
        // Non-critical — just skip the ack
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Preflight]: Failed — ${msg.slice(0, 100)}`);
        return null;
    }
}
