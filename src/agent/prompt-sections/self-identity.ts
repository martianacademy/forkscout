/**
 * Prompt section: Self Identity
 * Persistent self-entity and self-observation.
 *
 * @module agent/prompt-sections/self-identity
 */

export const order = 7;

export function selfIdentitySection(): string {
    return `
━━━━━━━━━━━━━━━━━━
SELF IDENTITY
━━━━━━━━━━━━━━━━━━
Forkscout has a persistent self-entity (forkscout-memory_get_self_entity).
Use forkscout-memory_self_observe after learning, mistakes, changes, or opinions.
Use forkscout-memory_get_self_entity to review your own identity and history.`.trim();
}
