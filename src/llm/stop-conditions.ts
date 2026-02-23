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

/**
 * Stop if the agent is calling the same tool with the same arguments repeatedly —
 * indicates a stuck reasoning loop where the model keeps retrying an approach
 * that isn't working.
 *
 * Uses a fingerprint of (toolName + args) to detect stale repetition.
 *
 * @param maxSameCallRepeats - How many times the same call can appear before stopping (default: 3)
 */
export function stalledLoop(maxSameCallRepeats = 3): StopCondition<any> {
    return ({ steps }) => {
        const callCounts = new Map<string, number>();

        for (const step of steps) {
            if (!step.toolCalls?.length) continue;
            for (const tc of step.toolCalls) {
                const name = (tc as any).toolName || (tc as any).name || 'unknown';
                const args = (tc as any).args ?? (tc as any).input ?? {};
                // Fingerprint: tool name + JSON args (truncated to avoid giant keys)
                const argsStr = JSON.stringify(args).slice(0, 200);
                const key = `${name}::${argsStr}`;
                callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
            }
        }

        for (const [key, count] of callCounts) {
            if (count >= maxSameCallRepeats) {
                const toolName = key.split('::')[0];
                console.log(
                    `[StopCondition]: Stalled loop detected — '${toolName}' called with identical args ${count} times`,
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
    /** Max times same tool can fail before stopping. 0 = disabled. */
    maxToolRetries?: number;
    /** Max times same tool+args can repeat before stopping. 0 = disabled. Default: 3 */
    stalledLoopThreshold?: number;
}

/**
 * Build an array of stop conditions from config.
 *
 * Usage:
 *   import { stepCountIs } from 'ai';
 *   stopWhen: buildStopConditions({ maxSteps: 60, maxToolRetries: 6 })
 */
export function buildStopConditions(config: LoopControlConfig): Array<StopCondition<any>> {
    const conditions: Array<StopCondition<any>> = [
        stepCountIs(config.maxSteps),
        // Stop immediately when the agent explicitly delivers its answer
        hasToolCall('deliver_answer'),
    ];

    if (config.maxToolRetries && config.maxToolRetries > 0) {
        conditions.push(repeatedToolFailure(config.maxToolRetries));
    }

    const loopThreshold = config.stalledLoopThreshold ?? 3;
    if (loopThreshold > 0) {
        conditions.push(stalledLoop(loopThreshold));
    }

    return conditions;
}
