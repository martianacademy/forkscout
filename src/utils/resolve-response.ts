/**
 * Response Resolution — extract a usable response from ToolLoopAgent output.
 *
 * Handles the common failure mode where the model runs tool calls successfully
 * but produces no final synthesis text. Falls through a priority chain:
 *
 *   1. result.text (the model's explicit final response)
 *   2. Step text (intermediate reasoning/text produced alongside tool calls)
 *   3. Tool results (spawn_agents output is already user-ready)
 *
 * Centralised here so all channels (CLI, HTTP, Telegram) share the same logic.
 *
 * @module utils/resolve-response
 */

import { getConfig } from '../config';

/** Tools whose output is structured enough to show the user directly. */
const HIGH_VALUE_TOOLS = new Set([
    'spawn_agents',
    'web_search',
    'browse_web',
    'read_file',
    'run_command',
    'http_request',
]);

/**
 * Resolve a final response from ToolLoopAgent generate() output.
 *
 * @param text    - `result.text` from generate()
 * @param steps   - `result.steps` from generate()
 * @returns Non-empty string if anything useful was found, empty string otherwise.
 */
export function resolveAgentResponse(
    text: string | undefined,
    steps: any[] | undefined,
): string {
    // 0. Check for deliver_answer tool — the agent explicitly delivered its response
    if (steps && steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        if (lastStep.toolResults?.length) {
            for (const tr of lastStep.toolResults) {
                if ((tr as any).toolName === 'deliver_answer') {
                    const answer = typeof (tr as any).output === 'string'
                        ? (tr as any).output
                        : JSON.stringify((tr as any).output);
                    if (answer?.trim()) return answer.trim();
                }
            }
        }
    }

    // 1. Model produced explicit final text — use it
    if (text?.trim()) return text.trim();

    if (!steps || steps.length === 0) return '';

    // 2. Collect intermediate step text (prefer the last non-empty one)
    for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].text?.trim()) {
            return steps[i].text.trim();
        }
    }

    // 3. Extract from tool results — prioritised by usefulness
    //    spawn_agents is highest priority since its output is already user-formatted.
    let bestResult = '';
    let bestPriority = -1;

    for (const step of steps) {
        if (!step.toolResults?.length) continue;

        for (const tr of step.toolResults) {
            const name: string = (tr as any).toolName || '';
            const raw = (tr as any).output;
            const content = typeof raw === 'string'
                ? raw
                : JSON.stringify(raw, null, 2);

            if (!content || content.length < getConfig().agent.resolveMinContentLength) continue;

            // spawn_agents is already a well-formatted report — use immediately
            if (name === 'spawn_agents') return content;

            // Other high-value tools — keep the longest
            const priority = HIGH_VALUE_TOOLS.has(name) ? 2 : 1;
            if (priority > bestPriority || (priority === bestPriority && content.length > bestResult.length)) {
                bestResult = content;
                bestPriority = priority;
            }
        }
    }

    return bestResult;
}
