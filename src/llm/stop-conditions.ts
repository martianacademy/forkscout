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

import { stepCountIs, type StopCondition } from 'ai';

// ── Budget-exceeded stop condition ─────────────────────

/**
 * Stop the loop if estimated cost exceeds a per-request budget.
 *
 * Uses token counts from step usage data and per-token pricing to estimate
 * cost across all steps in the current request. This is a safety net —
 * the primary budget tracking is in the ModelRouter.
 *
 * @param maxCostUSD - Maximum allowed cost in USD for this single request
 * @param inputPricePer1M - Cost per 1M input tokens (default: $0.50 — ~minimax pricing)
 * @param outputPricePer1M - Cost per 1M output tokens (default: $1.50 — ~minimax pricing)
 */
export function budgetExceeded(
    maxCostUSD: number,
    inputPricePer1M = 0.50,
    outputPricePer1M = 1.50,
): StopCondition<any> {
    return ({ steps }) => {
        const totalUsage = steps.reduce(
            (acc, step) => ({
                inputTokens: acc.inputTokens + (step.usage?.inputTokens ?? 0),
                outputTokens: acc.outputTokens + (step.usage?.outputTokens ?? 0),
            }),
            { inputTokens: 0, outputTokens: 0 },
        );

        const costEstimate =
            (totalUsage.inputTokens * inputPricePer1M +
                totalUsage.outputTokens * outputPricePer1M) / 1_000_000;

        if (costEstimate > maxCostUSD) {
            console.log(
                `[StopCondition]: Budget exceeded — $${costEstimate.toFixed(4)} > $${maxCostUSD} limit ` +
                `(${totalUsage.inputTokens} in + ${totalUsage.outputTokens} out tokens across ${steps.length} steps)`,
            );
            return true;
        }
        return false;
    };
}

// ── Idle-detection stop condition ──────────────────────

/**
 * Stop the loop if the model produces N consecutive steps with no tool calls.
 *
 * This catches the "model writes tool calls as text instead of invoking them"
 * failure mode — if the model isn't calling tools for several steps in a row,
 * it's likely stuck in a text-generation loop.
 *
 * @param threshold - Number of consecutive no-tool-call steps before stopping (default: 2)
 */
export function idleDetected(threshold = 2): StopCondition<any> {
    return ({ steps }) => {
        if (steps.length < threshold) return false;

        // Check last N steps for tool calls
        const tail = steps.slice(-threshold);
        const allIdle = tail.every(
            step => !step.toolCalls || step.toolCalls.length === 0,
        );

        if (allIdle && steps.length >= threshold) {
            console.log(
                `[StopCondition]: Idle detected — ${threshold} consecutive steps with no tool calls ` +
                `(${steps.length} total steps). Model may be stuck.`,
            );
            return true;
        }
        return false;
    };
}

// ── Token-limit stop condition ─────────────────────────

/**
 * Stop the loop if cumulative token usage exceeds a hard limit.
 *
 * Prevents runaway loops from consuming the entire context window.
 * Useful as a safety valve independent of cost.
 *
 * @param maxTotalTokens - Maximum combined input+output tokens across all steps
 */
export function tokenLimitExceeded(maxTotalTokens: number): StopCondition<any> {
    return ({ steps }) => {
        const total = steps.reduce(
            (sum, step) =>
                sum + (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
            0,
        );

        if (total > maxTotalTokens) {
            console.log(
                `[StopCondition]: Token limit exceeded — ${total} > ${maxTotalTokens} ` +
                `across ${steps.length} steps`,
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
                const output = typeof (tr as any).result === 'string' ? (tr as any).result : JSON.stringify((tr as any).result || '');
                if (output.includes('TOOL ERROR') || output.includes('Error:') || output.includes('ENOENT')) {
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
    /** Max USD spend per single request. 0 = disabled. */
    maxRequestCostUSD?: number;
    /** Consecutive no-tool-call steps before stopping. 0 = disabled. */
    idleStepThreshold?: number;
    /** Max total tokens per request. 0 = disabled. */
    maxRequestTokens?: number;
    /** Max times same tool can fail before stopping. 0 = disabled. */
    maxToolRetries?: number;
}

/**
 * Build an array of stop conditions from config.
 *
 * Usage:
 *   import { stepCountIs } from 'ai';
 *   stopWhen: buildStopConditions({ maxSteps: 60, maxRequestCostUSD: 0.50, ... })
 */
export function buildStopConditions(config: LoopControlConfig): Array<StopCondition<any>> {
    const conditions: Array<StopCondition<any>> = [
        stepCountIs(config.maxSteps),
    ];

    if (config.maxRequestCostUSD && config.maxRequestCostUSD > 0) {
        conditions.push(budgetExceeded(config.maxRequestCostUSD));
    }

    if (config.idleStepThreshold && config.idleStepThreshold > 0) {
        conditions.push(idleDetected(config.idleStepThreshold));
    }

    if (config.maxRequestTokens && config.maxRequestTokens > 0) {
        conditions.push(tokenLimitExceeded(config.maxRequestTokens));
    }

    if (config.maxToolRetries && config.maxToolRetries > 0) {
        conditions.push(repeatedToolFailure(config.maxToolRetries));
    }

    return conditions;
}
