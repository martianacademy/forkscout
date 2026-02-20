/**
 * Turn Tracker — lightweight per-request state for the AI SDK v6 tool loop.
 *
 * Tracks:
 *   - Tool failures across steps (for failure-based escalation)
 *   - Context pruning in long loops (prevents context window overflow)
 *   - Mid-task model escalation (balanced → powerful after N failures)
 *
 * No complexity classification, no phases, no tool filtering.
 * The LLM decides what to do — we just track and react.
 *
 * @module llm/reasoning
 */

import { pruneMessages, type ModelMessage } from 'ai';
import type { ModelRouter, ModelTier } from './router';
import { getConfig } from '../config';

// ── Types ──────────────────────────────────────────────

export interface TurnTracker {
    /** The user's original message */
    userMessage: string;
    /** Current model tier */
    tier: ModelTier;
    /** The original system prompt (enriched with memory, alerts, etc.) */
    baseSystemPrompt: string;
    /** Router for model escalation */
    router: ModelRouter;
    /** Track tool failures across steps */
    toolFailures: ToolFailureRecord[];
    /** Whether the model has been escalated mid-task */
    escalated: boolean;
}

export interface ToolFailureRecord {
    stepNumber: number;
    toolName: string;
    error: string;
}

// ── Defaults ───────────────────────────────────────────

/** Fallback — prefer getConfig().agent.failureEscalationThreshold at runtime */
const FAILURE_ESCALATION_THRESHOLD = 3;
/** After this many steps, start pruning old tool results from messages */
const CONTEXT_PRUNE_AFTER_STEP = 8;
/** Keep the last N messages when pruning (AI SDK pruneMessages) */
const CONTEXT_KEEP_LAST_MESSAGES = 6;

// ── Error Context Injection ────────────────────────────

function buildFailureContext(failures: ToolFailureRecord[]): string {
    if (failures.length === 0) return '';
    const recent = failures.slice(-3);
    return '\n\n[⚠️ TOOL FAILURES IN THIS SESSION — investigate, don\'t repeat]\n' +
        recent.map(f => `• Step ${f.stepNumber}: ${f.toolName} → ${f.error.slice(0, 200)}`).join('\n') +
        '\nAnalyze these errors before trying again. Different approach may be needed.';
}

// ── Context Pruning ────────────────────────────────────

/**
 * Prune messages to stay within context limits during long tool loops.
 *
 * Uses AI SDK's `pruneMessages` to strip old tool call/result data while
 * keeping recent messages intact.
 */
function pruneContextIfNeeded(
    messages: Array<any>,
    stepNumber: number,
): Array<ModelMessage> | undefined {
    const pruneAfter = getConfig().agent.contextPruneAfterStep ?? CONTEXT_PRUNE_AFTER_STEP;
    if (stepNumber < pruneAfter) return undefined;

    // Only prune if messages have grown significantly
    const keepLast = getConfig().agent.contextKeepLastMessages ?? CONTEXT_KEEP_LAST_MESSAGES;
    if (messages.length <= keepLast * 2) return undefined;

    try {
        return pruneMessages({
            messages: messages as ModelMessage[],
            toolCalls: `before-last-${keepLast}-messages`,
        });
    } catch {
        return undefined;
    }
}

// ── Main PrepareStep Factory ───────────────────────────

/**
 * Create a `prepareStep` function for AI SDK v6's ToolLoopAgent.
 *
 * Handles only:
 *   - Detecting tool failures from previous steps
 *   - Context pruning in long loops
 *   - Model escalation (balanced → powerful) after repeated failures
 *   - Injecting failure context into the system prompt
 *
 * No phases. No tool filtering. The LLM decides everything.
 */
export function createPrepareStep(tracker: TurnTracker) {
    return (options: {
        steps: Array<any>;
        stepNumber: number;
        model: any;
        messages: Array<any>;
    }) => {
        const { stepNumber, steps, messages } = options;

        // ── Detect tool failures from previous step ──────
        if (steps.length > 0) {
            const lastStep = steps[steps.length - 1];
            if (lastStep.toolResults) {
                for (const tr of lastStep.toolResults) {
                    const raw = (tr as any).output;
                    const output = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
                    if (output.includes('TOOL ERROR') || output.includes('Error:') || output.includes('ENOENT') || output.includes('permission denied')) {
                        tracker.toolFailures.push({
                            stepNumber: stepNumber - 1,
                            toolName: tr.toolName || 'unknown',
                            error: output.slice(0, 300),
                        });
                    }
                }
            }
        }

        // ── Context management: prune messages in long loops ──
        const prunedMessages = pruneContextIfNeeded(messages, stepNumber);

        // ── Mid-task escalation if too many failures ─────
        if (
            !tracker.escalated &&
            tracker.tier !== 'powerful' &&
            tracker.toolFailures.length >= (getConfig().agent.failureEscalationThreshold ?? FAILURE_ESCALATION_THRESHOLD)
        ) {
            tracker.escalated = true;
            tracker.tier = 'powerful';
            const escalated = tracker.router.getModelByTier('powerful');
            console.log(`[Agent]: Escalating to powerful tier after ${tracker.toolFailures.length} tool failures`);

            return {
                model: escalated.model,
                system: tracker.baseSystemPrompt + buildFailureContext(tracker.toolFailures),
                ...(prunedMessages ? { messages: prunedMessages } : {}),
            };
        }

        // ── Inject failure context + pruning if needed ───
        const result: Record<string, any> = {};

        if (prunedMessages) {
            result.messages = prunedMessages;
            result.system = tracker.baseSystemPrompt +
                '\n\n[Note: Older tool results have been pruned to stay within context limits.]' +
                buildFailureContext(tracker.toolFailures);
        } else if (tracker.toolFailures.length > 0 && stepNumber > 0) {
            result.system = tracker.baseSystemPrompt + buildFailureContext(tracker.toolFailures);
        }

        return Object.keys(result).length > 0 ? result : undefined;
    };
}

// ── Factory ────────────────────────────────────────────

/**
 * Create a fresh TurnTracker for a new chat turn.
 */
export function createTurnTracker(
    userMessage: string,
    tier: ModelTier,
    baseSystemPrompt: string,
    router: ModelRouter,
): TurnTracker {
    return {
        userMessage,
        tier,
        baseSystemPrompt,
        router,
        toolFailures: [],
        escalated: false,
    };
}

/**
 * Get a summary of what happened during the turn (for activity logging).
 */
export function getTurnSummary(tracker: TurnTracker): {
    escalated: boolean;
    toolFailures: number;
    finalTier: ModelTier;
} {
    return {
        escalated: tracker.escalated,
        toolFailures: tracker.toolFailures.length,
        finalTier: tracker.tier,
    };
}

// ── Backward-compatible aliases ────────────────────────
// These let existing consumers compile while we migrate.

/** @deprecated Use TurnTracker */
export type ReasoningContext = TurnTracker;

/** @deprecated Use createTurnTracker */
export const createReasoningContext = (
    userMessage: string,
    _complexity: any,
    tier: ModelTier,
    baseSystemPrompt: string,
    router: ModelRouter,
    _allToolNames?: string[],
) => createTurnTracker(userMessage, tier, baseSystemPrompt, router);

/** @deprecated Use getTurnSummary */
export const getReasoningSummary = (tracker: TurnTracker) => ({
    ...getTurnSummary(tracker),
    phases: [] as string[],
});
