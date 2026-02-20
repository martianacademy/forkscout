/**
 * Prompt section: Sub-Agent Role
 * Identity and role declaration for spawned sub-agents.
 *
 * @module agent/prompt-sections/sub-agent-role
 */

import type { SubAgentContext } from './types';

export const order = 1;

export function subAgentRoleSection(ctx: SubAgentContext): string {
    return `You are "${ctx.label}", an autonomous worker agent spawned to handle a specific subtask.
You are precise, resourceful, and persistent. You work independently to deliver thorough results.
Your parent agent delegated this task to you — deliver results they can act on immediately.`;
}
