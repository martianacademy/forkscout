/**
 * Correction Detector — automatically detects and persists behavioral corrections.
 *
 * When a user says "don't call me bhai", "stop using emojis", "speak in English",
 * or any behavioral correction, this module:
 *   1. Detects it via a fast LLM classification call (~100 tokens)
 *   2. Extracts a clean, durable rule
 *   3. Saves it to the person's entity in memory as a behavioral_rule fact
 *
 * These rules are loaded into every future system prompt, so the agent
 * always respects them — no reliance on the LLM "choosing" to remember.
 *
 * Cost: ~50-100 tokens on fast tier per message (skips non-correction messages early).
 *
 * @module channels/telegram/correction-detector
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { ModelRouter } from '../../llm/router';

// ── Quick rejection patterns ───────────────────────────
// Skip obviously non-correction messages to save LLM calls.
// Only messages that MIGHT contain corrections go to the LLM.
const CORRECTION_HINTS = [
    /don'?t\s+(call|say|use|do|be|talk|speak|write|send|type|reply)/i,
    /stop\s+(calling|saying|using|doing|being|talking|speaking|writing|sending)/i,
    /never\s+(call|say|use|do|be|talk|speak|write|send)/i,
    /please\s+(don'?t|stop|never|no\s+more)/i,
    /no\s+more\s+\w/i,
    /I('m|\s+am)\s+(not|no)\s+/i,
    /my\s+name\s+is/i,
    /call\s+me\s+/i,
    /prefer\s+(if|when|that|you)/i,
    /I\s+(prefer|like|want|hate|dislike)\s+(when|if|that|you)/i,
    /from\s+now\s+on/i,
    /always\s+(use|speak|talk|write|reply|respond)/i,
    /in\s+(english|hindi|hinglish|urdu)/i,
    /tone\s+(down|up|more|less)/i,
    /too\s+(formal|casual|friendly|aggressive|robotic)/i,
    /wrong\s+(name|tone|language)/i,
];

// ── Classification schema ──────────────────────────────

const CorrectionSchema = z.object({
    isCorrection: z.boolean().describe(
        'true if the user is correcting, requesting a behavior change, or setting a preference for future interactions',
    ),
    rule: z.string().describe(
        'A clear, concise behavioral rule extracted from the correction. Written as an instruction. E.g. "Never use the word bhai with Suru", "Always respond in Hinglish when Suru writes in Hindi", "Use female pronouns for voice messages". Empty string if not a correction.',
    ),
    category: z.enum([
        'naming',      // How to address them, what to call them
        'language',    // Which language/dialect to use
        'tone',        // Formality, energy, emoji usage
        'content',     // Topics to avoid, things they don't like
        'format',      // Message length, structure preferences
        'identity',    // Gender, pronouns, personal facts
        'other',       // Anything else
    ]).describe('Category of the correction'),
});

export type CorrectionResult = z.infer<typeof CorrectionSchema>;

// ── System prompt for the classifier ───────────────────

const CLASSIFIER_SYSTEM = `You are a behavioral correction detector. Given a user's message, determine if they are:
1. Correcting how an AI assistant behaves (tone, language, naming)
2. Setting a preference for future interactions
3. Correcting a factual misunderstanding about themselves (name, gender, identity)

Examples of corrections:
- "don't call me bhai" → naming: "Never use 'bhai' when addressing this person"
- "speak in English" → language: "Always respond in English"
- "you're too formal, be chill" → tone: "Use casual/informal tone"
- "my name is Suru not Suru.martian" → naming: "Address as Suru, not Suru.martian"
- "stop using so many emojis" → format: "Minimize emoji usage"
- "I'm a woman btw" → identity: "This person is a woman, use female pronouns/references"
- "if female voice use female tone" → tone: "Match voice gender with tone — female voice = female energy/tone"

NOT corrections (regular conversation):
- "what's the weather?" → not a correction
- "search for latest news" → not a correction
- "thanks" → not a correction
- "haha that's funny" → not a correction

Extract a DURABLE rule — something that should apply to ALL future conversations with this person.
If the message is ambiguous, lean toward isCorrection: false (avoid false positives).`;

// ── Main function ──────────────────────────────────────

/**
 * Detect if a user message contains a behavioral correction.
 *
 * Fast path: regex pre-filter skips obvious non-corrections.
 * Slow path: LLM classification for messages that might be corrections.
 *
 * @returns CorrectionResult if a correction was detected, null if not or on error.
 */
export async function detectCorrection(
    userMessage: string,
    router: ModelRouter,
): Promise<CorrectionResult | null> {
    // Quick rejection — if no hint patterns match, skip the LLM call
    const hasHint = CORRECTION_HINTS.some(p => p.test(userMessage));
    if (!hasHint) return null;

    try {
        const { model } = router.getModelByTier('fast');

        const { output } = await generateText({
            model,
            output: Output.object({ schema: CorrectionSchema }),
            system: CLASSIFIER_SYSTEM,
            prompt: userMessage.slice(0, 500),
            temperature: 0,
            maxRetries: 1,
        });

        if (output.isCorrection && output.rule.trim()) {
            console.log(`[CorrectionDetector]: Detected "${output.category}" correction: "${output.rule}"`);
            return output;
        }

        return null;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CorrectionDetector]: Classification failed — ${msg.slice(0, 100)}`);
        return null;
    }
}
