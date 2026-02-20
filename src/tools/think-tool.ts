/**
 * Think Tool — internal reasoning scratchpad.
 *
 * Lets the model "think out loud" without showing anything to the user.
 * The thought is returned as a tool result (fed back to the model as context)
 * but does NOT appear in the streamed response.
 *
 * Use cases:
 *   - Break down complex problems before acting
 *   - Evaluate multiple approaches before choosing one
 *   - Pause and check assumptions before risky operations
 *   - Chain reasoning across multiple tool calls
 *
 * This is a zero-cost tool — no LLM call, no external request.
 *
 * @module tools/think-tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import { withAccess } from './access';

export const think = withAccess('guest', tool({
    description: 'Use this tool to think through a problem step-by-step before acting. Your thoughts are private (not shown to the user) but returned as context for your next step. Use this when: (1) planning complex multi-step tasks, (2) evaluating multiple approaches, (3) checking assumptions before risky operations, (4) reasoning about errors before retrying.',
    inputSchema: z.object({
        thought: z.string().describe('Your internal reasoning, analysis, or plan. Be specific and structured.'),
    }),
    execute: async ({ thought }) => {
        // Log to console for debugging (not sent to user)
        console.log(`[Think]: ${thought.slice(0, 200)}${thought.length > 200 ? '…' : ''}`);
        return `[Internal reasoning recorded. Continue with your plan.]`;
    },
}));
