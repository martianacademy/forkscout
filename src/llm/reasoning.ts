/**
 * Reasoning Engine — implements a multi-phase inner loop using AI SDK v6's `prepareStep`.
 *
 * Implements all loop control patterns from the AI SDK v6 documentation:
 *
 * ## Stop Conditions (via stopWhen array):
 *   - `stepCountIs(N)` — hard step limit
 *   - `budgetExceeded(maxUSD)` — per-request cost cap
 *   - `idleDetected(N)` — stop after N consecutive no-tool-call steps
 *   - `repeatedToolFailure(N)` — stop if same tool fails N times
 *   - `tokenLimitExceeded(N)` — hard token cap
 *
 * ## prepareStep Phases:
 *   Phase 0 — PLAN (step 0):
 *     System prompt injection forces model to plan + call tools in one step.
 *     toolChoice: 'required' for complex tasks (force tool invocation, not text).
 *     activeTools: planning-safe subset (think, memory-read, manage_todos).
 *
 *   Phase 1 — EXECUTE (steps 1 – reflectStep-1):
 *     Full tool access. toolChoice: 'auto'.
 *     Context management: prune messages when conversation grows too long.
 *
 *   Phase 2 — REFLECT (reflectStep):
 *     Reflection prompt. activeTools: think + verification tools only.
 *
 *   Phase 3 — WRAP-UP (reflectStep+1 ... max):
 *     All tools available for final fixes. Failure context injected.
 *
 * ## Dynamic Model Selection:
 *   - Escalates from balanced→powerful after N tool failures
 *   - Enables Anthropic extended thinking for powerful+complex
 *
 * ## Context Management:
 *   - Prunes old tool results from messages when step count exceeds threshold
 *   - Uses AI SDK's `pruneMessages` to trim tool call data before last N messages
 *
 * @module llm/reasoning
 */

import { pruneMessages, type ModelMessage } from 'ai';
import type { ModelRouter, ModelTier } from './router';
import type { ComplexityResult } from './complexity';
import { getConfig } from '../config';

// ── Types ──────────────────────────────────────────────

export interface ReasoningContext {
    /** The user's original message */
    userMessage: string;
    /** Complexity classification */
    complexity: ComplexityResult;
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
    /** Phase tracking */
    phase: 'plan' | 'execute' | 'reflect' | 'wrapup';
    /** All tool names registered for this session — used for activeTools filtering */
    allToolNames: string[];
}

export interface ToolFailureRecord {
    stepNumber: number;
    toolName: string;
    error: string;
}

// ── Phase Boundaries ───────────────────────────────────

/** Fallback — prefer getConfig().agent.reflectStep at runtime */
const REFLECT_STEP = 15;
/** Fallback — prefer getConfig().agent.failureEscalationThreshold at runtime */
const FAILURE_ESCALATION_THRESHOLD = 3;
/** After this many steps, start pruning old tool results from messages */
const CONTEXT_PRUNE_AFTER_STEP = 8;
/** Keep the last N messages when pruning (AI SDK pruneMessages) */
const CONTEXT_KEEP_LAST_MESSAGES = 6;

// ── Tool Groups for activeTools ────────────────────────

/** Tools safe for the planning phase (read-only, reasoning, memory-read) */
const PLANNING_TOOLS = new Set([
    'think',
    'manage_todos',
    'get_current_date',
    'read_file',
    'list_directory',
    'view_activity_log',
]);

/** Memory-read tools (MCP) — allowed during planning */
const MEMORY_READ_PREFIXES = ['forkscout-mem_search_', 'forkscout-mem_get_', 'forkscout-mem_check_', 'forkscout-mem_memory_stats'];

/** Tools for the reflection phase — think + verification */
const REFLECT_TOOLS = new Set([
    'think',
    'manage_todos',
    'read_file',
    'list_directory',
    'run_command',
    'view_activity_log',
]);

/** Memory-write tools (MCP) — allowed during wrapup for recording findings */
const MEMORY_WRITE_PREFIXES = [
    'forkscout-mem_save_knowledge', 'forkscout-mem_add_entity', 'forkscout-mem_add_relation',
    'forkscout-mem_add_exchange', 'forkscout-mem_self_observe',
    'forkscout-mem_complete_task', 'forkscout-mem_abort_task',
];

/**
 * Filter tool names by phase.
 * Returns undefined (= all tools available) if the full set can't be determined.
 */
function getActiveToolsForPhase(
    phase: 'plan' | 'execute' | 'reflect' | 'wrapup',
    allToolNames: string[],
): string[] | undefined {
    if (allToolNames.length === 0) return undefined; // Can't filter without names

    switch (phase) {
        case 'plan': {
            const allowed = allToolNames.filter(name =>
                PLANNING_TOOLS.has(name) ||
                MEMORY_READ_PREFIXES.some(prefix => name.startsWith(prefix)),
            );
            // If filtering would empty the set, allow all (safety)
            return allowed.length > 0 ? allowed : undefined;
        }
        case 'reflect': {
            const allowed = allToolNames.filter(name =>
                REFLECT_TOOLS.has(name) ||
                MEMORY_READ_PREFIXES.some(prefix => name.startsWith(prefix)),
            );
            return allowed.length > 0 ? allowed : undefined;
        }
        case 'wrapup': {
            // Wrapup: all regular tools + ensure memory-write tools are included
            const allowed = allToolNames.filter(name =>
                REFLECT_TOOLS.has(name) ||
                MEMORY_READ_PREFIXES.some(prefix => name.startsWith(prefix)) ||
                MEMORY_WRITE_PREFIXES.some(prefix => name.startsWith(prefix)) ||
                name === 'run_command' || name === 'write_file',
            );
            return allowed.length > 0 ? allowed : undefined;
        }
        case 'execute':
        default:
            return undefined; // Full access
    }
}

// ── Planning Prompt ────────────────────────────────────

const PLANNING_INJECTION = `

━━━━ INSTRUCTIONS FOR THIS STEP ━━━━
This is a complex task. In this SAME response:
1. Write 1-3 sentences saying what you will do (your plan).
2. IMMEDIATELY call the tools you need — in this same step, not later.
Do NOT describe tool calls in text. CALL them using the tool API.
━━━━━━━━━━━━━━━━━━━━━━━━`;

const ACKNOWLEDGE_INJECTION = `

━━━━ INSTRUCTIONS FOR THIS STEP ━━━━
Write a brief 1-sentence acknowledgment, then IMMEDIATELY call the necessary tools in this same step.
Do NOT describe tool calls in text or code blocks — actually CALL them.
━━━━━━━━━━━━━━━━━━━━━━━━`;

// ── Reflection Prompt ──────────────────────────────────

const REFLECTION_INJECTION = `

━━━━ REFLECTION CHECKPOINT ━━━━
You have been working on this task. Before responding to the user, evaluate:

1. Did I actually solve the problem, or just attempt to?
2. What evidence do I have that it's fixed? (Did I verify, or just assume?)
3. Are there any errors or warnings I ignored?
4. Should I run one more verification step?

If you're not confident the task is complete, continue working.
If you are confident, provide a clear summary of what you did and the evidence it worked.
━━━━━━━━━━━━━━━━━━━━━━━━`;

// ── Context Management Prompt ──────────────────────────

const CONTEXT_PRUNE_NOTICE = `\n\n[Note: Older tool results have been pruned to stay within context limits. Recent results are preserved.]`;

// ── Error Context Injection ────────────────────────────

function buildFailureContext(failures: ToolFailureRecord[]): string {
    if (failures.length === 0) return '';
    const recent = failures.slice(-3);
    return `\n\n[⚠️ TOOL FAILURES IN THIS SESSION — investigate, don't repeat]\n` +
        recent.map(f => `• Step ${f.stepNumber}: ${f.toolName} → ${f.error.slice(0, 200)}`).join('\n') +
        `\nAnalyze these errors before trying again. Different approach may be needed.`;
}

// ── Provider Options ───────────────────────────────────

/**
 * Build provider options for extended thinking (Anthropic models only).
 * Budget scales with complexity.
 */
function getThinkingOptions(tier: ModelTier, complexity: ComplexityResult, modelId: string): Record<string, any> | undefined {
    // Only enable thinking for Anthropic models on powerful tier with complex tasks
    if (tier !== 'powerful' || complexity.complexity !== 'complex') return undefined;
    if (!modelId.includes('anthropic') && !modelId.includes('claude')) return undefined;

    return {
        anthropic: {
            thinking: {
                type: 'enabled',
                budgetTokens: 8000,
            },
        },
    };
}

// ── Context Pruning ────────────────────────────────────

/**
 * Prune messages to stay within context limits during long tool loops.
 *
 * Uses AI SDK's `pruneMessages` to strip old tool call/result data while
 * keeping recent messages intact. This prevents context window overflow
 * in long-running agent sessions.
 */
function pruneContextIfNeeded(
    messages: Array<any>,
    stepNumber: number,
): Array<ModelMessage> | undefined {
    const pruneAfter = getConfig().agent.contextPruneAfterStep ?? CONTEXT_PRUNE_AFTER_STEP;
    if (stepNumber < pruneAfter) return undefined;

    // Only prune if messages have grown significantly
    if (messages.length <= CONTEXT_KEEP_LAST_MESSAGES * 2) return undefined;

    try {
        const keepLast = getConfig().agent.contextKeepLastMessages ?? CONTEXT_KEEP_LAST_MESSAGES;
        return pruneMessages({
            messages: messages as ModelMessage[],
            toolCalls: `before-last-${keepLast}-messages`,
        });
    } catch {
        // If pruning fails (e.g. message format issue), return undefined (use original)
        return undefined;
    }
}

// ── Main PrepareStep Factory ───────────────────────────

/**
 * Create a `prepareStep` function for AI SDK v6's streamText/generateText.
 *
 * This function is called before every LLM step in the tool loop and can:
 *   - Override the system prompt (inject planning, reflection prompts)
 *   - Set `activeTools` — restrict which tools are available per phase
 *   - Set `toolChoice` — force tool usage or specific tool selection
 *   - Override `messages` — prune context for long-running loops
 *   - Swap the model (escalate from balanced to powerful on failures)
 *   - Set provider options (enable Anthropic thinking)
 */
export function createPrepareStep(context: ReasoningContext) {
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
                    const output = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result || '');
                    if (output.includes('TOOL ERROR') || output.includes('Error:') || output.includes('ENOENT') || output.includes('permission denied')) {
                        context.toolFailures.push({
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

        // ── Phase 0: ACKNOWLEDGE / PLAN (step 0, moderate+ tasks) ──
        // We inject a planning prompt and restrict tools to planning-safe subset.
        // toolChoice: 'required' for complex tasks — forces tool invocation,
        // preventing the "writes tool calls as text" failure mode.
        if (stepNumber === 0 && context.complexity.complexity !== 'simple') {
            context.phase = 'plan';
            const modelInfo = context.router.getModelByTier(context.tier);
            const providerOpts = getThinkingOptions(context.tier, context.complexity, modelInfo.modelId);

            // Complex: detailed planning + forced tool use. Moderate: quick ack.
            const isComplex = context.complexity.complexity === 'complex';
            const injection = isComplex ? PLANNING_INJECTION : ACKNOWLEDGE_INJECTION;

            // activeTools: restrict to planning-safe tools
            const activeTools = getActiveToolsForPhase('plan', context.allToolNames);

            return {
                system: context.baseSystemPrompt + injection,
                ...(activeTools ? { activeTools } : {}),
                // Force tools for complex tasks to prevent text-only responses
                ...(isComplex ? { toolChoice: 'required' as const } : {}),
                ...(providerOpts ? { providerOptions: providerOpts } : {}),
            };
        }

        // ── Mid-task escalation if too many failures ─────
        if (
            !context.escalated &&
            context.tier !== 'powerful' &&
            context.toolFailures.length >= (getConfig().agent.failureEscalationThreshold ?? FAILURE_ESCALATION_THRESHOLD)
        ) {
            context.escalated = true;
            context.tier = 'powerful';
            const escalated = context.router.getModelByTier('powerful');
            console.log(`[Reasoning]: Escalating to powerful tier after ${context.toolFailures.length} tool failures`);

            const providerOpts = getThinkingOptions('powerful', context.complexity, escalated.modelId);
            return {
                model: escalated.model,
                system: context.baseSystemPrompt + buildFailureContext(context.toolFailures),
                ...(prunedMessages ? { messages: prunedMessages } : {}),
                ...(providerOpts ? { providerOptions: providerOpts } : {}),
            };
        }

        // ── Phase 2: REFLECT ─────────────────────────────
        const reflectStep = getConfig().agent.reflectStep ?? REFLECT_STEP;
        if (stepNumber === reflectStep && context.complexity.complexity !== 'simple') {
            context.phase = 'reflect';
            const activeTools = getActiveToolsForPhase('reflect', context.allToolNames);
            return {
                system: context.baseSystemPrompt + REFLECTION_INJECTION + buildFailureContext(context.toolFailures),
                ...(activeTools ? { activeTools } : {}),
                ...(prunedMessages ? { messages: prunedMessages } : {}),
            };
        }

        // ── Phase 1 & 3: EXECUTE / WRAP-UP ──────────────
        if (stepNumber >= reflectStep) {
            context.phase = 'wrapup';
        } else if (stepNumber > 0) {
            context.phase = 'execute';
        }

        // Build result object — accumulate optional overrides
        const result: Record<string, any> = {};

        // Inject context pruning notice when messages were trimmed
        if (prunedMessages) {
            result.messages = prunedMessages;
            result.system = context.baseSystemPrompt + CONTEXT_PRUNE_NOTICE + buildFailureContext(context.toolFailures);
        } else if (context.toolFailures.length > 0 && stepNumber > 0) {
            result.system = context.baseSystemPrompt + buildFailureContext(context.toolFailures);
        }

        // Enable thinking for powerful tier on complex tasks (all execution steps)
        if (stepNumber > 0 && context.tier === 'powerful' && context.complexity.complexity === 'complex') {
            const modelInfo = context.router.getModelByTier(context.tier);
            const providerOpts = getThinkingOptions(context.tier, context.complexity, modelInfo.modelId);
            if (providerOpts) {
                result.providerOptions = providerOpts;
            }
        }

        return Object.keys(result).length > 0 ? result : undefined;
    };
}

/**
 * Create a fresh ReasoningContext for a new chat turn.
 */
export function createReasoningContext(
    userMessage: string,
    complexity: ComplexityResult,
    tier: ModelTier,
    baseSystemPrompt: string,
    router: ModelRouter,
    allToolNames: string[] = [],
): ReasoningContext {
    return {
        userMessage,
        complexity,
        tier,
        baseSystemPrompt,
        router,
        toolFailures: [],
        escalated: false,
        phase: 'plan',
        allToolNames,
    };
}

/**
 * Get a summary of what happened during reasoning (for activity logging).
 */
export function getReasoningSummary(context: ReasoningContext): {
    escalated: boolean;
    toolFailures: number;
    finalTier: ModelTier;
    phases: string[];
} {
    return {
        escalated: context.escalated,
        toolFailures: context.toolFailures.length,
        finalTier: context.tier,
        phases: ['plan', 'execute', context.toolFailures.length > 0 ? 'error-recovery' : null, 'reflect'].filter(Boolean) as string[],
    };
}
