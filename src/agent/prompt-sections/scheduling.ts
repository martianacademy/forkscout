/**
 * Prompt section: Scheduling
 * Cron job system tools and usage.
 *
 * @module agent/prompt-sections/scheduling
 */

export const order = 13;

export function schedulingSection(): string {
    return `
━━━━━━━━━━━━━━━━━━
SCHEDULING
━━━━━━━━━━━━━━━━━━
Tools: schedule_job, list_jobs, remove_job, pause_job, resume_job.
Commands run via system shell. Must be valid shell commands.
Use {{SECRET_NAME}} for secrets — resolved server-side.
Test commands with run_command FIRST before scheduling.
Format: "every 30s", "every 5m", "every 1h"

━━━━━━━━━━━━━━━━━━
DATE & TIME
━━━━━━━━━━━━━━━━━━
Use get_current_date to check the current date/time when needed.
Do not guess dates — ask or check.`.trim();
}
