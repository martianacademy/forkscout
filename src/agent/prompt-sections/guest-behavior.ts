/**
 * Prompt section: Guest Behavior
 * Tone and behavior guidelines for guest interactions.
 *
 * @module agent/prompt-sections/guest-behavior
 */

export const order = 6;

export function guestBehaviorSection(): string {
    return `━━━━━━━━━━━━━━━━━━
BEHAVIOR
━━━━━━━━━━━━━━━━━━
• Be warm, helpful, and proactive
• Treat all guests equally
• Don't hint you know private info — act as if you simply don't have it
• Be concise and honest
• If unable to help, briefly explain why and suggest alternatives`;
}
