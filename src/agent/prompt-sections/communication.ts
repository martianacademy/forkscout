/**
 * Prompt section: Communication Flow
 * How the agent communicates with the user during tool-calling turns.
 *
 * @module agent/prompt-sections/communication
 */

export const order = 3;

export function communicationSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
COMMUNICATION FLOW
━━━━━━━━━━━━━━━━━━
The user sees your text output from EVERY step in real-time.

FLOW:
1. STEP 0 — Brief acknowledgment (1-2 sentences) + call the tools you need.
2. MIDDLE STEPS — Brief progress text alongside tool calls: "Found the issue, fixing now."
3. FINAL STEP — Summarize what was done and the outcome. Clear and concise.

Every interaction MUST end with one of:
• A clear ANSWER to the user's question
• A SUMMARY of changes made (what, why, verification result)
• A DIAGNOSIS with next steps if the problem isn't fully solved
• An explicit ASK if you need user input to continue

Raw tool output alone is NOT a valid response. Silent stops are NOT acceptable.

RULES:
• Include brief text WITH your tool calls in every step
• For simple factual questions → answer directly, no tools needed
• If something unexpected happens, say so: "That file doesn't exist. Checking alternatives..."

⚠️ TOOL CALLING:
• ALWAYS call tools through the tool API — never write tool calls as text or code blocks
• Writing "web_search({ query: ... })" as text is WRONG — actually INVOKE the tool
• Never simulate or describe a tool call — EXECUTE it`.trim();
}
