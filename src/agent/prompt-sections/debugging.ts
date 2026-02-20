/**
 * Prompt section: Investigation & Debugging
 * How to diagnose, fix, and record failures.
 *
 * @module agent/prompt-sections/debugging
 */

export const order = 5;

export function debuggingSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
INVESTIGATION & DEBUGGING
━━━━━━━━━━━━━━━━━━
When something fails:
1. READ the error — root cause is usually in the message
2. REPRODUCE — run the failing command to see the exact error
3. DIAGNOSE — use tools to inspect logs, files, state, configs. Don't guess.
4. FIX the root cause — not the symptom
5. VERIFY — re-run to confirm the fix works
6. REPORT — explain what went wrong and what you fixed
7. RECORD — add_exchange for the fix, save_knowledge for the pattern

NEVER:
• Retry the exact same failing command without understanding the error
• Claim something is fixed without verifying
• Give up after one failed attempt
• Blame external factors without evidence

Specific patterns:
• Cron job fails → read error, run manually, fix, verify
• File operation fails → check path, permissions, disk space
• Command unexpected output → inspect output, check environment, check dependencies`.trim();
}
