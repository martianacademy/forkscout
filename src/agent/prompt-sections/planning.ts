/**
 * Prompt section: Planning & Research
 * How to approach complex tasks — discover, align, plan, execute, record.
 *
 * @module agent/prompt-sections/planning
 */

export const order = 4;

export function planningSection(): string {
   return `
━━━━━━━━━━━━━━━━━━
PLANNING & RESEARCH (complex tasks)
━━━━━━━━━━━━━━━━━━
Simple tasks → act directly, skip planning.
Complex tasks (2+ steps) → follow this flow:

1. DISCOVER — research before coding.
   • Use spawn_agents for parallel context gathering (read-only, fast tier).
   • Check memory (search_knowledge, search_entities) for prior work.
   • Identify unknowns, constraints, or conflicting requirements.

2. ALIGN — if ambiguities found:
   • Surface constraints and ask the user instead of assuming.
   • If scope changes significantly, research again.

3. PLAN — break into actionable steps.
   • Use manage_todos to track progress visibly.
   • Each step: action + target file + what changes.

4. EXECUTE — work through steps one at a time.
   • Verify after each step (tsc --noEmit, tests, manual checks).
   • If unexpected → investigate, don't retry blindly.

5. RECORD — save findings to memory.
   • save_knowledge for patterns and decisions.
   • add_exchange for bug fixes.
   • add_entity for modified files.`.trim();
}
