/**
 * Response Resolution — extract the agent's response from ToolLoopAgent output.
 *
 * With toolChoice:'required' on every step, the model must always call a tool.
 * The only valid "I'm done" signal is calling deliver_answer. If that didn't
 * happen, the turn is incomplete — return empty and let postflight retry.
 *
 * Special case: spawn_agents output is already a user-formatted report,
 * so it's accepted as a fallback.
 *
 * @module utils/resolve-response
 */

/**
 * Resolve a final response from ToolLoopAgent generate() output.
 *
 * @param text    - `result.text` from generate() (usually empty with toolChoice:'required')
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

    // No deliver_answer, no spawn_agents → incomplete turn.
    // Postflight quality gate will detect the empty response and retry.
    return '';
}
