/**
 * Prompt section: Guest Execution
 * Simplified execution rules for guest users.
 *
 * @module agent/prompt-sections/guest-execution
 */

import type { GuestContext } from './types';

export const order = 4;

export function guestExecutionSection(ctx: GuestContext): string {
    return `━━━━━━━━━━━━━━━━━━
EXECUTION
━━━━━━━━━━━━━━━━━━
• After every tool call → ANALYZE the result → RESPOND to the user.
• Never call a tool and go silent — always produce a final answer or summary.
• If a tool fails, explain what happened and try an alternative.${ctx.hasTodos ? '\n• For multi-step tasks, track progress with manage_todos.' : ''}
• You have multiple tool steps per turn — use them to deliver thorough results.`;
}
