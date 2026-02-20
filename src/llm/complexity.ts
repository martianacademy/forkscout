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

/** Keywords strongly suggesting debugging, investigation, or complex reasoning.
 *  Weighted: [keyword, score]. Higher score = stronger signal.
 *  - 3: Very strong (debugging, investigation terms)
 *  - 2: Strong (coding, architecture, multi-step)
 *  - 1: Mild (common action words that could be simple or complex)
 */
const COMPLEX_KEYWORDS: [string, number][] = [
    // Debugging & troubleshooting (strong signals)
    ['debug', 3], ['investigate', 3], ['diagnose', 3], ['troubleshoot', 3], ['root cause', 3],
    ['why is', 3], ['why does', 3], ['why isn\'t', 3], ['why doesn\'t', 3], ['why won\'t', 3], ['why not', 2],
    ['what\'s wrong', 3], ['what went wrong', 3], ['not working', 3], ['doesn\'t work', 3], ['broken', 3],
    ['failing', 3], ['keeps failing', 3], ['still failing', 3], ['failed again', 3],
    ['error', 2], ['bug', 2], ['issue', 1], ['problem', 1], ['crash', 3], ['exception', 3],
    ['stack trace', 3], ['stacktrace', 3], ['traceback', 3], ['segfault', 3], ['core dump', 3],
    ['undefined', 1], ['null', 1], ['nan', 1], ['type error', 3], ['syntax error', 3],
    // Analysis & reasoning
    ['analyze', 2], ['explain why', 3], ['figure out', 2], ['find out', 2], ['look into', 2],
    ['deep dive', 3], ['thorough', 2], ['comprehensive', 2],
    ['how does', 2], ['how do', 1], ['how is', 1], ['how can', 1],
    ['what happens when', 2], ['what if', 1],
    // Code & architecture (strong signals)
    ['refactor', 3], ['rewrite', 3], ['implement', 2], ['build', 1], ['architect', 3], ['design', 2],
    ['review code', 3], ['code review', 3], ['optimize', 2], ['performance', 2],
    ['write a', 1], ['write me', 1], ['create a', 1], ['make a', 1], ['set up', 1], ['setup', 1],
    ['deploy', 2], ['configure', 2], ['install', 1], ['integrate', 2], ['connect', 1],
    ['api', 1], ['endpoint', 2], ['database', 1], ['schema', 2], ['migration', 2],
    ['test', 1], ['unit test', 2], ['e2e', 2], ['coverage', 2],
    // Multi-step tasks
    ['step by step', 2], ['plan', 1], ['strategy', 2], ['migration', 2],
    ['compare', 1], ['evaluate', 2], ['tradeoff', 2], ['pros and cons', 2],
    ['automate', 2], ['pipeline', 2], ['workflow', 2], ['cron', 1], ['schedule', 1],
    // File & system operations
    ['fix', 2], ['patch', 2], ['update', 1], ['upgrade', 2], ['change', 1], ['modify', 1], ['edit', 1],
    ['delete', 1], ['remove', 1], ['clean up', 1], ['cleanup', 1],
    ['move', 1], ['rename', 1], ['restructure', 2], ['reorganize', 2],
    // Research & web
    ['search for', 1], ['search the', 2], ['find me', 1], ['look up', 1], ['research', 2],
    ['scrape', 2], ['crawl', 2], ['fetch', 1], ['download', 1],
    // Agent/multi-agent
    ['spawn', 3], ['sub-agent', 2], ['agents', 2], ['parallel', 2],
    // Security & auth
    ['security', 2], ['vulnerability', 3], ['auth', 1], ['permission', 2], ['access', 1],
    ['encrypt', 2], ['decrypt', 2], ['token', 1], ['credential', 2],
];

/** Patterns that signal repeated frustration (user asking again) */
const FRUSTRATION_PATTERNS = [
    /again/i, /still/i, /already told/i, /said before/i,
    /same (error|issue|problem|bug)/i, /keeps? (happening|failing|breaking)/i,
    /how many times/i, /please (actually|really|just)/i,
    /why (isn't|doesn't|won't|can't) (it|this|that)/i,
    /i (already|just) (said|asked|told)/i,
    /you (said|told|promised|claimed)/i,
    /didn't (work|help|fix|solve)/i,
    /try again/i, /one more time/i,
    /come on/i, /seriously/i, /wtf/i, /wth/i,
];

/** Quick/simple patterns — if message matches ONLY these, stay on balanced */
const SIMPLE_PATTERNS = [
    /^(hi|hello|hey|yo|sup|thanks|thank you|thx|ty|ok|okay|yes|no|yep|nope|sure|got it|cool|nice|great|good|fine|alright|k|kk)/i,
    /^what (time|date|day) is it/i,
    /^(who|what) (are|is) (you|your name)/i,
    /^(list|show|display|check|view) (my )?(jobs|tools|status|crons?|vitals|health)/i,
    /^(good )?(morning|evening|night|afternoon)/i,
    /^(gm|gn|brb|ttyl|bye|cya|later)/i,
    /^how are you/i,
    /^what can you do/i,
    /^help$/i,
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

    // Trivially simple patterns (greetings, basic questions) — skip scoring
    if (SIMPLE_PATTERNS.some(p => p.test(msg))) {
        return { complexity: 'simple', tier: 'balanced', reason: 'simple/greeting' };
    }

    let score = 0;
    const triggers: string[] = [];

    // Check for complex keywords with weighted scoring
    // Longer phrases matched first to avoid double-counting substrings
    const matched = new Set<string>();
    const sortedKeywords = [...COMPLEX_KEYWORDS].sort((a, b) => b[0].length - a[0].length);
    for (const [kw, weight] of sortedKeywords) {
        if (msg.includes(kw) && !matched.has(kw)) {
            // Skip if a longer phrase already matched containing this keyword
            const alreadyCovered = [...matched].some(m => m.includes(kw) && m !== kw);
            if (alreadyCovered) continue;
            score += weight;
            triggers.push(kw);
            matched.add(kw);
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

    // Multiple action verbs = multi-step task
    const actionVerbs = ['then', 'after that', 'also', 'and then', 'next', 'finally', 'first'];
    const verbCount = actionVerbs.filter(v => msg.includes(v)).length;
    if (verbCount >= 2) {
        score += 2;
        triggers.push('multi-step');
    }

    // Code-like content (backticks, file paths, code snippets)
    if (msg.includes('```') || msg.includes('`') || /\.\w{2,4}$/.test(msg) || /\/\w+\/\w+/.test(msg)) {
        score += 1;
        triggers.push('code-context');
    }

    // URLs suggest web/integration tasks
    if (/https?:\/\//.test(msg)) {
        score += 1;
        triggers.push('url');
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
