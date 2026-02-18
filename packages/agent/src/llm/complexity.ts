/**
 * Task Complexity Detector — classifies user messages to route to the right model tier.
 *
 * Uses fast keyword/pattern heuristics (no LLM call) to detect complex tasks
 * that warrant the powerful tier. Falls back to balanced for everything else.
 *
 * @module llm/complexity
 */

import type { ModelTier } from './router';

// ── Patterns that signal complex/debugging tasks ───────

/** Keywords strongly suggesting debugging, investigation, or complex reasoning */
const COMPLEX_KEYWORDS = [
    // Debugging & troubleshooting
    'debug', 'investigate', 'diagnose', 'troubleshoot', 'root cause',
    'why is', 'why does', 'why isn\'t', 'why doesn\'t', 'why won\'t', 'why not',
    'what\'s wrong', 'what went wrong', 'not working', 'doesn\'t work', 'broken',
    'failing', 'keeps failing', 'still failing', 'failed again',
    'error', 'bug', 'issue', 'problem', 'crash', 'exception',
    // Analysis & reasoning
    'analyze', 'explain why', 'figure out', 'find out', 'look into',
    'deep dive', 'thorough', 'comprehensive',
    // Code & architecture
    'refactor', 'rewrite', 'implement', 'build', 'architect', 'design',
    'review code', 'code review', 'optimize',
    // Multi-step tasks
    'step by step', 'plan', 'strategy', 'migration',
    'compare', 'evaluate', 'tradeoff', 'pros and cons',
];

/** Patterns that signal repeated frustration (user asking again) */
const FRUSTRATION_PATTERNS = [
    /again/i, /still/i, /already told/i, /said before/i,
    /same (error|issue|problem|bug)/i, /keeps? (happening|failing|breaking)/i,
    /how many times/i, /please (actually|really|just)/i,
    /why (isn't|doesn't|won't|can't) (it|this|that)/i,
];

/** Quick/simple patterns — if message matches ONLY these, stay on balanced */
const SIMPLE_PATTERNS = [
    /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|got it)/i,
    /^what (time|date|day) is it/i,
    /^(who|what) (are|is) (you|your name)/i,
    /^(list|show|display) (my )?(jobs|tools|status)/i,
];

// ── Classifier ─────────────────────────────────────────

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface ComplexityResult {
    complexity: TaskComplexity;
    /** Recommended model tier */
    tier: ModelTier;
    /** Why this classification was made */
    reason: string;
}

/**
 * Classify a user message's complexity using heuristics.
 * No LLM call — instant, zero cost.
 */
export function classifyComplexity(userMessage: string): ComplexityResult {
    const msg = userMessage.toLowerCase().trim();

    // Very short or trivially simple messages
    if (msg.length < 20 || SIMPLE_PATTERNS.some(p => p.test(msg))) {
        return { complexity: 'simple', tier: 'balanced', reason: 'simple/greeting' };
    }

    let score = 0;
    const triggers: string[] = [];

    // Check for complex keywords
    for (const kw of COMPLEX_KEYWORDS) {
        if (msg.includes(kw)) {
            score += 2;
            triggers.push(kw);
        }
    }

    // Check frustration patterns (user repeating themselves = they need thorough help)
    for (const pattern of FRUSTRATION_PATTERNS) {
        if (pattern.test(msg)) {
            score += 3;
            triggers.push('frustration');
            break; // Only count frustration once
        }
    }

    // Message length as a signal — longer messages usually mean more complex asks
    if (msg.length > 200) score += 1;
    if (msg.length > 500) score += 1;

    // Question marks often mean investigation needed
    const questionMarks = (msg.match(/\?/g) || []).length;
    if (questionMarks >= 2) score += 1;

    // Classify
    if (score >= 4) {
        return {
            complexity: 'complex',
            tier: 'powerful',
            reason: `complex (${triggers.slice(0, 3).join(', ')})`,
        };
    }

    if (score >= 2) {
        return {
            complexity: 'moderate',
            tier: 'balanced',
            reason: `moderate (${triggers.slice(0, 3).join(', ')})`,
        };
    }

    return { complexity: 'simple', tier: 'balanced', reason: 'general' };
}
