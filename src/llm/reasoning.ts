/**
 * Reasoning Engine — implements a multi-phase inner loop using AI SDK v6's `prepareStep`.
 *
 * Instead of a single flat tool loop, the agent now operates in phases:
 *
 *   Phase 0 — PLAN (step 0):
 *     System prompt override forces the model to output a plan before acting.
 *     toolChoice: 'none' — no tools allowed during planning.
 *
 *   Phase 1 — EXECUTE (steps 1–16):
 *     Normal tool execution with full tool access.
 *     If tools return errors, inject remediation guidance into step context.
 *
 *   Phase 2 — REFLECT (step 17):
 *     After execution, inject a reflection prompt asking the model to evaluate:
 *     "Did I actually solve the problem? What evidence do I have?"
 *     If the model finds it didn't solve it, it still has 3 steps to continue.
 *
 *   Phase 3 — WRAP-UP (steps 18-20):
 *     Final steps for any remaining work the reflection identified.
 *
 * The engine also:
 *   - Enables Anthropic extended thinking for powerful-tier models
 *   - Tracks tool failures across steps for pattern detection
 *   - Escalates model mid-task if balanced-tier is struggling
 *
 * @module llm/reasoning
 */

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

// ── Planning Prompt ────────────────────────────────────

const PLANNING_INJECTION = `

━━━━ PLANNING PHASE ━━━━
Before diving into tool calls, start your response with a brief plan:

1. What is the user asking for?
2. What information do I need to gather first?
3. What tools should I use, and in what order?
4. What could go wrong, and how will I verify success?

Output your plan as a brief numbered list FIRST, then proceed to call tools.
━━━━━━━━━━━━━━━━━━━━━━━━`;

const ACKNOWLEDGE_INJECTION = `

━━━━ ACKNOWLEDGE FIRST ━━━━
Before using any tools, start your response with a brief acknowledgment.
Tell the user what you understood and what you're about to do, in 1-2 natural sentences.
Keep it short and conversational — no bullet lists, no formality.
Then proceed to call the necessary tools.
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

// ── Main PrepareStep Factory ───────────────────────────

/**
 * Create a `prepareStep` function for AI SDK v6's streamText/generateText.
 *
 * This function is called before every LLM step in the tool loop and can:
 *   - Override the system prompt (inject planning, reflection prompts)
 *   - Swap the model (escalate from balanced to powerful on failures)
 *   - Restrict tools (no tools during planning phase)
 *   - Set provider options (enable Anthropic thinking)
 */
export function createPrepareStep(context: ReasoningContext) {
    return (options: {
        steps: Array<any>;
        stepNumber: number;
        model: any;
        messages: Array<any>;
    }) => {
        const { stepNumber, steps } = options;

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

        // ── Phase 0: ACKNOWLEDGE / PLAN (step 0, moderate+ tasks) ──
        // NOTE: We do NOT set toolChoice:'none' here. AI SDK terminates the
        // step loop when there are zero tool calls in a step. Instead, we inject
        // an acknowledgment/planning prompt into the system message and let the
        // model produce text alongside its first tool calls. The handler sends
        // the text part early via onStepFinish.
        if (stepNumber === 0 && context.complexity.complexity !== 'simple') {
            context.phase = 'plan';
            const modelInfo = context.router.getModelByTier(context.tier);
            const providerOpts = getThinkingOptions(context.tier, context.complexity, modelInfo.modelId);

            // Complex: detailed planning. Moderate: quick acknowledgment.
            const injection = context.complexity.complexity === 'complex'
                ? PLANNING_INJECTION
                : ACKNOWLEDGE_INJECTION;

            return {
                system: context.baseSystemPrompt + injection,
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
                ...(providerOpts ? { providerOptions: providerOpts } : {}),
            };
        }

        // ── Phase 2: REFLECT ─────────────────────────────
        const reflectStep = getConfig().agent.reflectStep ?? REFLECT_STEP;
        if (stepNumber === reflectStep && context.complexity.complexity !== 'simple') {
            context.phase = 'reflect';
            return {
                system: context.baseSystemPrompt + REFLECTION_INJECTION + buildFailureContext(context.toolFailures),
            };
        }

        // ── Phase 1 & 3: EXECUTE / WRAP-UP ──────────────
        if (stepNumber >= reflectStep) {
            context.phase = 'wrapup';
        } else if (stepNumber > 0) {
            context.phase = 'execute';
        }

        // Inject failure context if there have been errors
        if (context.toolFailures.length > 0 && stepNumber > 0) {
            return {
                system: context.baseSystemPrompt + buildFailureContext(context.toolFailures),
            };
        }

        // Enable thinking for powerful tier on complex tasks (all execution steps)
        if (stepNumber > 0 && context.tier === 'powerful' && context.complexity.complexity === 'complex') {
            const modelInfo = context.router.getModelByTier(context.tier);
            const providerOpts = getThinkingOptions(context.tier, context.complexity, modelInfo.modelId);
            if (providerOpts) {
                return { providerOptions: providerOpts };
            }
        }

        return undefined;
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
