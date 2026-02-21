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

export const deliver_answer = tool({
    description:
        'Call this when you have completed the task and are ready to deliver your final response to the user. ' +
        'Pass your complete answer as the `answer` parameter. This ends the current turn.',
    inputSchema: z.object({
        answer: z.string().describe('Your complete final response to the user'),
    }),
    execute: async ({ answer }) => answer,
});
