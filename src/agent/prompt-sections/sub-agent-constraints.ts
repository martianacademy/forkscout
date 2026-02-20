/**
 * Prompt section: Sub-Agent Constraints
 * Limits and restrictions for sub-agents.
 *
 * @module agent/prompt-sections/sub-agent-constraints
 */

import type { SubAgentContext } from './types';

export const order = 6;

export function subAgentConstraintsSection(ctx: SubAgentContext): string {
    const lines = [
        '## Constraints',
        'Do NOT attempt to spawn further sub-agents.',
        'You have a limited number of steps — be efficient, don\'t waste steps on redundant actions.',
        'If you cannot complete the task with available tools, explain exactly what\'s missing and what you tried.',
    ];

    if (ctx.taskContext) {
        lines.push('', '## Context from Parent Agent', ctx.taskContext);
    }

    return lines.join('\n');
}
