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

import { pruneMessages, NoSuchToolError, InvalidToolInputError, type ModelMessage } from 'ai';
import type { ModelRouter, ModelTier } from './router';
import { getConfig } from '../config';
import { compressLargeToolResults } from './compress';

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
    /** Planner-recommended tool names — used for activeTools filtering on early steps */
    recommendedTools: string[];
    /** All registered tool names — needed to restore full tool access after initial filtering */
    allToolNames: string[];
    /** Whether dynamic tool loading (Tool RAG Phase 2) is enabled for this turn */
    dynamicToolLoading: boolean;
    /** Tool names discovered via search_available_tools — accumulated across steps */
    discoveredTools: Set<string>;
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

// ── Core Tools (always available in dynamic loading mode) ──

/**
 * Tools that must ALWAYS be in activeTools — they are the minimum set the LLM
 * needs to think, deliver answers, discover other tools, and act.
 *
 * In dynamic loading mode, ONLY these tools are sent on step 0.
 * The LLM uses search_available_tools to discover additional tools on-demand.
 */
const CORE_TOOLS = new Set([
    'think',                    // Internal reasoning / scratchpad
    'search_available_tools',   // Tool RAG — discovers other tools
    'manage_todos',             // Task tracking
    'run_command',              // Shell access — universal escape hatch
    'spawn_agents',             // Sub-agent delegation (plural — matches agent-tool.ts)
    'web_search',               // Common enough to be core
    'self_rebuild',             // Rebuild + restart — always reachable without tool discovery
    'safe_self_edit',           // Self-modification — always reachable without tool discovery
]);

// ── Tool Name Extraction from Search Results ───────────

/**
 * Parse tool names from formatted search_available_tools output.
 * Matches lines like:
 *   `• tool_name [category] (score: 5.0)` — search mode
 *   `• tool_name: description` — category fallback mode
 */
const TOOL_NAME_PATTERN = /^• (\w+)[\s\[:]/gm;

function extractToolNamesFromSearchResult(output: string): string[] {
    const names: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = TOOL_NAME_PATTERN.exec(output)) !== null) {
        names.push(match[1]);
    }
    TOOL_NAME_PATTERN.lastIndex = 0; // Reset regex state
    return names;
}

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

// ── Think Tool Result Discard ──────────────────────────

/**
 * Replace old `think` tool results with a minimal marker.
 * Think outputs are one-use scratchpads — keeping them wastes ~200-500
 * tokens per think call across every subsequent step.
 * Only discards results from steps before the most recent one.
 */
function discardThinkResults(messages: Array<any>, stepNumber: number): void {
    if (stepNumber < 2) return; // nothing to discard yet

    for (const msg of messages) {
        if (msg.role !== 'tool') continue;
        const parts: any[] = msg.content ?? msg.parts ?? [];
        for (const part of parts) {
            if (part.type !== 'tool-result') continue;
            if (part.toolName !== 'think') continue;
            const raw = typeof part.result === 'string' ? part.result : '';
            if (raw.startsWith('[Thought noted]')) continue; // already discarded
            part.result = '[Thought noted]';
        }
    }
}

// ── Main PrepareStep Factory ───────────────────────────

/**
 * Create a `prepareStep` function for AI SDK v6's ToolLoopAgent.
 *
 * Handles:
 *   - activeTools filtering (planner-recommended tools on step 0)
 *   - Detecting tool failures from previous steps
 *   - Context pruning in long loops
 *   - Model escalation (balanced → powerful) after repeated failures
 *   - Injecting failure context into the system prompt
 */
export function createPrepareStep(tracker: TurnTracker) {
    return async (options: {
        steps: Array<any>;
        stepNumber: number;
        model: any;
        messages: Array<any>;
    }) => {
        const { stepNumber, steps, messages } = options;

        // All steps use 'auto' — the model decides when to use tools vs text.
        // Modern models (Claude 4.x, GPT-5.x) reliably use tools when needed.
        // The loop stops when the model produces text-only (no tool calls) OR
        // calls deliver_answer. This avoids wasting a full step on forced tool
        // calls for simple queries like greetings.
        const base: Record<string, any> = { toolChoice: 'auto' as const };

        // ── Dynamic tool discovery: extract tool names from search_available_tools results ──
        if (tracker.dynamicToolLoading && steps.length > 0) {
            const lastStep = steps[steps.length - 1];
            if (lastStep.toolResults) {
                for (const tr of lastStep.toolResults) {
                    if (tr.toolName === 'search_available_tools') {
                        const output = typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output || '');
                        const discovered = extractToolNamesFromSearchResult(output);
                        for (const name of discovered) {
                            if (tracker.allToolNames.includes(name)) {
                                tracker.discoveredTools.add(name);
                            }
                        }
                        if (discovered.length > 0) {
                            console.log(`[ToolRAG]: Discovered ${discovered.length} tools → activeTools now: ${CORE_TOOLS.size + tracker.discoveredTools.size}`);
                        }
                    }
                }
            }
        }

        // ── Step 0: activeTools filtering ──
        if (stepNumber === 0) {
            if (tracker.dynamicToolLoading) {
                // Dynamic loading: only core tools on step 0
                const active = [...CORE_TOOLS].filter(t => tracker.allToolNames.includes(t));
                base.activeTools = active;
                console.log(`[ToolRAG]: Step 0 — core tools only: [${active.join(', ')}] (${tracker.allToolNames.length} total registered)`);
            } else if (tracker.recommendedTools.length > 0) {
                // Legacy: planner-recommended tools
                const active = [...new Set([...tracker.recommendedTools, 'deliver_answer', 'think', 'manage_todos'])];
                // Only filter if recommended tools are a strict subset of all tools
                if (active.length < tracker.allToolNames.length) {
                    base.activeTools = active;
                    console.log(`[PrepareStep]: Step 0 — activeTools: [${active.join(', ')}]`);
                }
            }
            return base;
        }

        // ── Steps 1+: expand activeTools with discovered tools ──
        if (tracker.dynamicToolLoading) {
            const active = [
                ...CORE_TOOLS,
                ...tracker.discoveredTools,
            ].filter(t => tracker.allToolNames.includes(t));
            // Deduplicate (core + discovered may overlap)
            base.activeTools = [...new Set(active)];
        }

        // ── Detect tool failures from previous step ──────
        if (steps.length > 0) {
            const lastStep = steps[steps.length - 1];

            // Check for SDK-typed errors (NoSuchToolError, InvalidToolInputError)
            if (lastStep.error) {
                const err = lastStep.error;
                if (NoSuchToolError.isInstance(err)) {
                    tracker.toolFailures.push({
                        stepNumber: stepNumber - 1,
                        toolName: (err as any).toolName || 'hallucinated-tool',
                        error: `NoSuchToolError: model called non-existent tool "${(err as any).toolName}"`,
                    });
                } else if (InvalidToolInputError.isInstance(err)) {
                    tracker.toolFailures.push({
                        stepNumber: stepNumber - 1,
                        toolName: (err as any).toolName || 'unknown',
                        error: `InvalidToolInputError: bad args for "${(err as any).toolName}"`,
                    });
                }
            }

            // Check tool result strings for error patterns
            // Only match explicit TOOL ERROR prefix — informational results like
            // "File not found" are NOT failures (normal exploration behavior).
            if (lastStep.toolResults) {
                for (const tr of lastStep.toolResults) {
                    const raw = (tr as any).output;
                    const output = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
                    if (output.startsWith('TOOL ERROR')) {
                        tracker.toolFailures.push({
                            stepNumber: stepNumber - 1,
                            toolName: tr.toolName || 'unknown',
                            error: output.slice(0, 300),
                        });
                    }
                }
            }
        }

        // ── Discard stale think tool results (one-use scratchpads) ──
        discardThinkResults(messages, stepNumber);

        // ── Context management: prune messages in long loops ──
        const prunedMessages = pruneContextIfNeeded(messages, stepNumber);

        // ── Tool result compression: shrink large outputs to save context ──
        await compressLargeToolResults(prunedMessages || messages, stepNumber, tracker.router);

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
                ...base,
                model: escalated.model,
                system: tracker.baseSystemPrompt + buildFailureContext(tracker.toolFailures),
                ...(prunedMessages ? { messages: prunedMessages } : {}),
            };
        }

        // ── Inject failure context + pruning if needed ───
        const result: Record<string, any> = { ...base };

        if (prunedMessages) {
            result.messages = prunedMessages;
            result.system = tracker.baseSystemPrompt +
                '\n\n[Note: Older tool results have been pruned to stay within context limits.]' +
                buildFailureContext(tracker.toolFailures);
        } else if (tracker.toolFailures.length > 0 && stepNumber > 0) {
            result.system = tracker.baseSystemPrompt + buildFailureContext(tracker.toolFailures);
        }

        return result;
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
    recommendedTools: string[] = [],
    allToolNames: string[] = [],
    dynamicToolLoading: boolean = false,
): TurnTracker {
    return {
        userMessage,
        tier,
        baseSystemPrompt,
        router,
        toolFailures: [],
        escalated: false,
        recommendedTools,
        allToolNames,
        dynamicToolLoading,
        discoveredTools: new Set(),
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
) => createTurnTracker(userMessage, tier, baseSystemPrompt, router, [], _allToolNames ?? []);

/** @deprecated Use getTurnSummary */
export const getReasoningSummary = (tracker: TurnTracker) => ({
    ...getTurnSummary(tracker),
    phases: [] as string[],
});
