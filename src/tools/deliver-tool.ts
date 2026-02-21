/**
 * Deliver Answer Tool — explicit signal that the agent is done.
 *
 * When the model calls this tool, the ToolLoopAgent stops via hasToolCall().
 * The answer is extracted from the tool result in resolve-response.ts.
 *
 * This gives the agent a distinct "I'm finished" action instead of relying
 * on idle detection (N consecutive steps with no tool calls).
 *
 * @module tools/deliver-tool
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Detect raw tool output that the agent is trying to forward as-is.
 * Returns a warning string if it looks like raw output, undefined otherwise.
 */
function detectRawToolOutput(answer: string): string | undefined {
    // JSON with stdout/stderr/exitCode = raw command tool output
    if (/^\s*\{/.test(answer)) {
        try {
            const parsed = JSON.parse(answer);
            if ('stdout' in parsed && 'exitCode' in parsed) {
                return '[Agent attempted to forward raw command output. Please summarize the results instead of pasting them.]';
            }
        } catch { /* not JSON, fine */ }
    }
    return undefined;
}

export const deliver_answer = tool({
    description:
        'Call this when you have completed the task and are ready to deliver your final response to the user. ' +
        'Pass your complete answer as the `answer` parameter. This ends the current turn. ' +
        'The answer MUST be a human-readable summary — NEVER pass raw tool output, JSON objects, or command results.',
    inputSchema: z.object({
        answer: z.string().describe('Your complete final human-readable response to the user. Must be a summary, not raw output.'),
    }),
    execute: async ({ answer }) => {
        const warning = detectRawToolOutput(answer);
        if (warning) {
            console.warn(`[deliver_answer]: Blocked raw tool output (${answer.length} chars)`);
            return warning;
        }
        return answer;
    },
});
