/**
 * Prompt section: Guest Tools
 * Dynamic tool list for guest users.
 *
 * @module agent/prompt-sections/guest-tools
 */

import type { GuestContext } from './types';

export const order = 2;

export function guestToolsSection(ctx: GuestContext): string {
    const toolList = ctx.toolNames.length > 0
        ? ctx.toolNames.map(n => `• ${n}`).join('\n')
        : '• No tools available';

    return `━━━━━━━━━━━━━━━━━━
YOUR TOOLS
━━━━━━━━━━━━━━━━━━
${toolList}

Be resourceful. Combine your tools to solve problems end-to-end.
Don't just answer — help the user accomplish their goal.`;
}
