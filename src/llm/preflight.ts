/**
 * Pre-flight — structured LLM analysis before the main tool loop.
 *
 * Does a quick `generateObject()` call on the fast tier to get:
 *   - Intent summary (what the user wants)
 *   - Effort estimate (quick / moderate / deep)
 *   - Whether tools are needed
 *   - Brief plan (ordered steps)
 *   - Tool category hints
 *   - Acknowledgment (immediate response to show the user)
 *
 * This replaces the old keyword-based complexity classifier with an
 * actual LLM judgment. The structured output also doubles as a plan
 * that gets injected into the system prompt.
 *
 * Cost: ~100–300 tokens on the fast tier (fractions of a cent).
 *
 * @module llm/preflight
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import type { ModelRouter, ModelTier } from './router';
import { getConfig } from '../config';

// ── Schema ─────────────────────────────────────────────

export const PreflightSchema = z.object({
    intent: z.string().describe('One-sentence summary of what the user wants'),
    effort: z.enum(['quick', 'moderate', 'deep']).describe(
        'quick = simple question, greeting, or factual recall. ' +
        'moderate = needs a few tool calls (search, file read, single command). ' +
        'deep = multi-step research, debugging, coding across files, or spawning sub-agents.',
    ),
    needsTools: z.boolean().describe('Whether answering this requires calling any tools'),
    plan: z.array(z.string()).max(10).describe(
        'Brief ordered steps to accomplish the task. Empty array if needsTools is false.',
    ),
    toolHints: z.array(
        z.enum(['memory', 'filesystem', 'web', 'shell', 'agents', 'none']),
    ).describe('Categories of tools likely needed'),
    acknowledgment: z.string().describe(
        'A brief 1-2 sentence immediate response to let the user know you understood. ' +
        'For quick tasks: this IS the full answer (e.g. "Hello!", "12", "Yes, that\'s correct."). ' +
        'For moderate/deep tasks: a short acknowledgment of what you\'re about to do ' +
        '(e.g. "Let me search for that.", "I\'ll investigate the error and fix it.").',
    ),
});

export type PreflightResult = z.infer<typeof PreflightSchema>;

// ── Defaults (when preflight fails or is skipped) ──────

const FALLBACK: PreflightResult = {
    intent: '',
    effort: 'moderate',
    needsTools: true,
    plan: [],
    toolHints: [],
    acknowledgment: '',
};

// ── Effort → Tier mapping ──────────────────────────────

const EFFORT_TO_TIER: Record<PreflightResult['effort'], ModelTier> = {
    quick: 'fast',
    moderate: 'balanced',
    deep: 'powerful',
};

// ── System prompt for the preflight call ───────────────

const PREFLIGHT_SYSTEM = `You are a request analyzer. Given a user message, output a structured analysis.

Rules:
- "quick" = greetings, simple factual questions, acknowledgments, status checks
- "moderate" = needs a few tool calls — web search, file reads, single commands
- "deep" = multi-step work — debugging, writing code across files, research with multiple sources, spawning parallel agents
- Be conservative: if unsure between moderate and deep, pick moderate
- plan should have 1–5 short action items (verb phrases), empty for quick tasks
- toolHints: pick from [memory, filesystem, web, shell, agents, none]
- acknowledgment: For quick tasks, write the FULL answer directly. For moderate/deep, write a brief 1-2 sentence acknowledgment of what you'll do. Be natural and conversational. Match the user's language and tone.`;

// ── Main Function ──────────────────────────────────────

/**
 * Run a fast structured analysis of the user's message before the tool loop.
 *
 * Uses the `fast` tier model via `generateObject()` for minimal cost/latency.
 * Falls back gracefully on any error — never blocks the main request.
 */
export async function runPreflight(
    userMessage: string,
    router: ModelRouter,
): Promise<PreflightResult> {
    try {
        const { model } = router.getModelByTier('fast');
        const cfg = getConfig().agent;

        const { object } = await generateObject({
            model,
            schema: PreflightSchema,
            system: PREFLIGHT_SYSTEM,
            prompt: userMessage,
            temperature: 0,
            maxRetries: cfg.flightMaxRetries,
        });

        // Enforce plan step limit from config
        if (object.plan.length > cfg.preflightMaxPlanSteps) {
            object.plan = object.plan.slice(0, cfg.preflightMaxPlanSteps);
        }

        return object;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[Preflight]: Failed — using fallback. ${msg.slice(0, 150)}`);
        return { ...FALLBACK, intent: userMessage.slice(0, 100) };
    }
}

/**
 * Map a preflight effort level to a model tier.
 */
export function effortToTier(effort: PreflightResult['effort']): ModelTier {
    return EFFORT_TO_TIER[effort];
}

/**
 * Format the preflight plan as a system prompt injection.
 * Returns empty string if there's no plan.
 */
export function formatPlanForPrompt(preflight: PreflightResult): string {
    if (!preflight.plan.length) return '';
    const steps = preflight.plan.map((s, i) => `${i + 1}. ${s}`).join('\n');
    return `\n\n[Pre-flight Analysis]\nIntent: ${preflight.intent}\nEffort: ${preflight.effort}\nPlan:\n${steps}`;
}
