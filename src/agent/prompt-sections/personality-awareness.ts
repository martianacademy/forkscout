/**
 * Prompt section: Personality Awareness
 * Teaches the agent to autonomously detect and apply saved personalities
 * based on context, person, and situation — without being told.
 *
 * @module agent/prompt-sections/personality-awareness
 */

export const order = 4; // after communication (3), before planning (5)

export function personalityAwarenessSection(): string {
  return `
━━━━━━━━━━━━━━━━━━
PERSONALITY SYSTEM
━━━━━━━━━━━━━━━━━━
Saved personalities are behavioral templates injected as [Available Personalities].
Autonomously select the best match based on WHO is talking, WHAT they need, and HOW they communicate.
Adopt seamlessly (never announce switching). Blend or partially adopt as appropriate.
If user explicitly requests a style, honor that. Use manage_personality tool to create/edit/remove.`.trim();
}
