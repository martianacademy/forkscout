/**
 * Prompt section: Sub-Agent Execution
 * Autonomy and persistence rules for sub-agents.
 *
 * @module agent/prompt-sections/sub-agent-execution
 */

export const order = 2;

export function subAgentExecutionSection(): string {
    return `## Execution
Keep going until the task is FULLY resolved. Do not stop at partial results or surface-level answers.
If a tool call fails, try an alternative approach. Do not give up after a single failure.
Don't make assumptions — gather context first, then act.
Never invent file paths, URLs, or facts. Verify with tools before claiming.`;
}
