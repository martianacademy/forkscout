/**
 * Failure Memory — captures failed tool sequences so the agent learns
 * what NOT to do and can reference past failures when facing similar issues.
 *
 * After each chat turn that had tool failures, we:
 *   1. Extract the failure pattern (tool name + error type + context)
 *   2. Store it as a "failure episode" in the knowledge graph
 *   3. On future turns, relevant failures are surfaced via memory context
 *
 * This turns transient errors into persistent knowledge.
 *
 * @module memory/failure-memory
 */

import type { ReasoningContext } from '../llm/reasoning';

// ── Types ──────────────────────────────────────────────

export interface FailureEpisode {
    /** When this failure occurred */
    timestamp: string;
    /** The user's request that triggered the failure */
    userMessage: string;
    /** What tools failed and how */
    failures: Array<{
        toolName: string;
        error: string;
        errorType: string;
    }>;
    /** Whether the issue was eventually resolved in the same turn */
    resolved: boolean;
    /** How it was resolved (if applicable) */
    resolution?: string;
}

// ── Error Classification ───────────────────────────────

function classifyToolError(error: string): string {
    const e = error.toLowerCase();
    if (e.includes('enoent') || e.includes('not found') || e.includes('no such file')) return 'file-not-found';
    if (e.includes('eacces') || e.includes('permission')) return 'permission-denied';
    if (e.includes('syntax error') || e.includes('unexpected token')) return 'syntax-error';
    if (e.includes('timeout') || e.includes('timed out')) return 'timeout';
    if (e.includes('command not found')) return 'command-missing';
    if (e.includes('enospc') || e.includes('no space')) return 'disk-full';
    if (e.includes('connection') || e.includes('econnrefused')) return 'connection-error';
    if (e.includes('&amp;') || e.includes('&lt;') || e.includes('&gt;')) return 'html-escape-in-command';
    return 'unknown';
}

// ── Build Failure Knowledge ────────────────────────────

/**
 * Build a knowledge graph observation from a finished reasoning context.
 * Returns null if there were no failures worth recording.
 */
export function buildFailureObservation(
    context: ReasoningContext,
    finalText: string,
): string | null {
    if (context.toolFailures.length === 0) return null;

    const failures = context.toolFailures.map(f => ({
        toolName: f.toolName,
        error: f.error.slice(0, 200),
        errorType: classifyToolError(f.error),
    }));

    // Deduplicate by tool+errorType
    const unique = new Map<string, typeof failures[0]>();
    for (const f of failures) {
        const key = `${f.toolName}:${f.errorType}`;
        if (!unique.has(key)) unique.set(key, f);
    }

    const resolved = finalText.length > 50; // rough heuristic: if agent produced substantial output, probably resolved
    const uniqueFailures = Array.from(unique.values());

    const entry: FailureEpisode = {
        timestamp: new Date().toISOString(),
        userMessage: context.userMessage.slice(0, 200),
        failures: uniqueFailures,
        resolved,
        resolution: resolved ? finalText.slice(0, 200) : undefined,
    };

    // Format as a knowledge graph observation
    const failureSummary = uniqueFailures
        .map(f => `${f.toolName} failed with ${f.errorType}: ${f.error.slice(0, 100)}`)
        .join('; ');

    const observation = resolved
        ? `[FAILURE→RESOLVED] When asked "${entry.userMessage.slice(0, 100)}", encountered: ${failureSummary}. ` +
        `Resolution: ${entry.resolution}`
        : `[FAILURE→UNRESOLVED] When asked "${entry.userMessage.slice(0, 100)}", encountered: ${failureSummary}. ` +
        `This was NOT resolved — need different approach next time.`;

    return observation;
}

/**
 * Build a concise failure context string for injection into future system prompts.
 * Meant to be small enough to not waste tokens.
 */
export function buildFailureLessons(pastFailures: string[]): string {
    if (pastFailures.length === 0) return '';

    return '\n\n[LESSONS FROM PAST FAILURES — avoid repeating these mistakes]\n' +
        pastFailures.slice(-5).map((f, i) => `${i + 1}. ${f}`).join('\n');
}
