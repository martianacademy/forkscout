/**
 * Response Resolution — extract a usable response from ToolLoopAgent output.
 *
 * Priority chain:
 *   1. deliver_answer tool result (any step — explicit "I'm done" signal)
 *   2. result.text (the model's explicit final text)
 *   3. Step text (intermediate reasoning/text produced alongside tool calls)
 *   4. spawn_agents output (already user-formatted reports)
 *
 * Raw tool output (read_file, run_command, etc.) is NEVER used as a response.
 * If nothing usable is found, returns empty string → postflight will detect
 * the empty response and retry with a stronger model.
 *
 * @module utils/resolve-response
 */

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
    // 0. Check for deliver_answer tool across ALL steps (not just last)
    //    deliver_answer is the canonical "I'm done" signal. hasToolCall stop condition
    //    should make it the last step, but check all steps defensively.
    if (steps && steps.length > 0) {
        for (let i = steps.length - 1; i >= 0; i--) {
            const step = steps[i];
            if (!step.toolResults?.length) continue;
            for (const tr of step.toolResults) {
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

    // 3. spawn_agents output is already a user-formatted report — use it directly.
    //    No other tool output is used. read_file, run_command, etc. are data for
    //    the agent to process, NOT user-ready responses.
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if (!step.toolResults?.length) continue;
        for (const tr of step.toolResults) {
            if ((tr as any).toolName === 'spawn_agents') {
                const raw = (tr as any).output;
                const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
                if (content?.trim()) return content.trim();
            }
        }
    }

    // Nothing usable found — return empty. Postflight quality gate will detect
    // the empty response and trigger a retry with a stronger model.
    return '';
}
