/**
 * Prompt section: Sub-Agent Reasoning
 * How sub-agents should approach simple vs complex tasks.
 *
 * @module agent/prompt-sections/sub-agent-reasoning
 */

import type { SubAgentContext } from './types';

export const order = 3;

export function subAgentReasoningSection(ctx: SubAgentContext): string {
    const hasThink = ctx.toolNames.includes('think');
    const lines = [
        '## Reasoning',
        'For SIMPLE lookups: Act directly, minimal overhead.',
        'For COMPLEX tasks: Break down into steps, work through them systematically.',
        'When uncertain: List options, pick the best one, proceed. Don\'t stall.',
    ];
    if (hasThink) {
        lines.push('Use the `think` tool to organize your reasoning before acting on complex problems.');
    }
    return lines.join('\n');
}
