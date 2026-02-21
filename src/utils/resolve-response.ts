/**
 * Response Resolution — extract the agent's response from ToolLoopAgent output.
 *
 * Priority chain:
 *   1. deliver_answer tool result (canonical "I'm done" signal)
 *   2. spawn_agents output (already user-formatted report)
 *   3. result.text (model produced final text — happens when model ignores toolChoice:'required')
 *
 * Raw tool output (read_file, run_command, etc.) is NEVER used as a response.
 * If nothing usable is found, returns empty string → postflight will detect
 * the empty response.
 *
 * @module utils/resolve-response
 */

/**
 * Resolve a final response from ToolLoopAgent generate() output.
 *
 * @param text    - `result.text` from generate()
 * @param steps   - `result.steps` from generate()
 * @returns Non-empty string if a valid response was found, empty string otherwise.
 */
export function resolveAgentResponse(
    text: string | undefined,
    steps: any[] | undefined,
): string {
    if (!steps || steps.length === 0) return text?.trim() || '';

    // 1. deliver_answer — the canonical "I'm done" signal.
    //    Scan all steps (last-to-first) defensively.
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

    // 2. spawn_agents — its output is already a user-formatted report.
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

    // 3. result.text — model produced final text output.
    //    This happens when the model ignores toolChoice:'required' and returns
    //    text instead of calling deliver_answer. The text is often the actual answer.
    if (text?.trim()) return text.trim();

    // Nothing usable found.
    return '';
}
