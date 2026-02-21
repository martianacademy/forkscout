/**
 * Custom Stop Conditions for the AI SDK v6 agent loop.
 *
 * Built on the StopCondition<TOOLS> type from AI SDK v6:
 *   type StopCondition<TOOLS> = (options: { steps: StepResult<TOOLS>[] }) => boolean | PromiseLike<boolean>
 *
 * These are combined with built-in conditions (`stepCountIs`, `hasToolCall`)
 * via the array syntax: `stopWhen: [condition1, condition2, ...]`
 * The loop stops when ANY condition returns true.
 *
 * @module llm/stop-conditions
 */

import { stepCountIs, hasToolCall, type StopCondition } from 'ai';

// ── Idle-detection stop condition ──────────────────────

/**
 * Tools that represent internal reasoning/planning progress.
 * Steps calling ONLY these tools are "thinking" — not idle, but not
 * doing external work either. We allow some thinking steps before
 * considering the model stuck.
 */
const LOGIC_TOOLS = new Set(['manage_todos', 'think', 'deliver_answer']);

/**
 * Stop the loop if the model produces N consecutive steps with no meaningful tool calls.
 *
 * A step counts as "active" if it calls at least one tool that is NOT purely
 * internal logic (manage_todos, think). Steps with only logic tools or no
 * tool calls at all are "idle." This prevents the model from endlessly
 * planning without acting, while still allowing a few reasoning steps.
 *
 * @param threshold - Number of consecutive idle steps before stopping (default: 5)
 */
export function idleDetected(threshold = 5): StopCondition<any> {
    return ({ steps }) => {
        if (steps.length < threshold) return false;

        // Check last N steps for meaningful (non-logic-only) tool calls
        const tail = steps.slice(-threshold);
        const allIdle = tail.every(step => {
            const calls = step.toolCalls || [];
            if (calls.length === 0) return true; // no tool calls at all → idle
            // If every tool call is a logic tool, still counts as idle
            return calls.every((tc: any) => LOGIC_TOOLS.has(tc.toolName));
        });

        if (allIdle) {
            console.log(
                `[StopCondition]: Idle detected — ${threshold} consecutive steps with no external tool calls ` +
                `(${steps.length} total steps). Model may be stuck in a planning loop.`,
            );
            return true;
        }
        return false;
    };
}

// ── Repeated-tool-failure stop condition ───────────────

/**
 * Stop if the same tool has failed N times in the current request.
 *
 * Detects when the model keeps retrying a broken tool call with the same
 * tool name, which wastes steps and budget.
 *
 * @param maxRepeats - Maximum times the same tool can fail before stopping (default: 3)
 */
export function repeatedToolFailure(maxRepeats = 3): StopCondition<any> {
    return ({ steps }) => {
        const failCounts = new Map<string, number>();
        for (const step of steps) {
            if (!step.toolResults) continue;
            for (const tr of step.toolResults) {
                // AI SDK v6 StepResult content parts use .output (not .result)
                const raw = (tr as any).output;
                const output = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
                // Only match explicit TOOL ERROR prefix — not informational "File not found" etc.
                if (output.startsWith('TOOL ERROR')) {
                    const name = (tr as any).toolName || 'unknown';
                    failCounts.set(name, (failCounts.get(name) ?? 0) + 1);
                }
            }
        }

        for (const [toolName, count] of failCounts) {
            if (count >= maxRepeats) {
                console.log(
                    `[StopCondition]: Repeated tool failure — '${toolName}' failed ${count} times across ${steps.length} steps`,
                );
                return true;
            }
        }
        return false;
    };
}

// ── Factory: build stop conditions from config ─────────

export interface LoopControlConfig {
    maxSteps: number;
    /** Consecutive no-tool-call steps before stopping. 0 = disabled. */
    idleStepThreshold?: number;
    /** Max times same tool can fail before stopping. 0 = disabled. */
    maxToolRetries?: number;
}

/**
 * Build an array of stop conditions from config.
 *
 * Usage:
 *   import { stepCountIs } from 'ai';
 *   stopWhen: buildStopConditions({ maxSteps: 60, idleStepThreshold: 3, maxToolRetries: 6 })
 */
export function buildStopConditions(config: LoopControlConfig): Array<StopCondition<any>> {
    const conditions: Array<StopCondition<any>> = [
        stepCountIs(config.maxSteps),
        // Stop immediately when the agent explicitly delivers its answer
        hasToolCall('deliver_answer'),
    ];

    if (config.idleStepThreshold && config.idleStepThreshold > 0) {
        conditions.push(idleDetected(config.idleStepThreshold));
    }

    if (config.maxToolRetries && config.maxToolRetries > 0) {
        conditions.push(repeatedToolFailure(config.maxToolRetries));
    }

    return conditions;
}
