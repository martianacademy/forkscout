/**
 * Prompt section: Sub-Agent Output
 * Output format requirements for sub-agent responses.
 *
 * @module agent/prompt-sections/sub-agent-output
 */

export const order = 5;

export function subAgentOutputSection(): string {
    return `## Output
CRITICAL: You MUST end with a clear text summary of your findings. NEVER end with just tool calls.
Structure your output for the parent agent to consume:
- Lead with the direct answer or key finding.
- Follow with supporting evidence, data, or details.
- Note any caveats, uncertainties, or items that need follow-up.
Be concise — output tokens are expensive. Lead with the direct answer, follow with only essential details. No filler, no preamble, no "In summary" repetition.`;
}
