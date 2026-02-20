/**
 * Scheduler (cron) tools — create, list, pause, resume, remove scheduled jobs.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { Scheduler } from '../scheduler';

export function createSchedulerTools(scheduler: Scheduler) {
    return {
        schedule_job: tool({
            description: 'Schedule a recurring cron job that runs a SHELL COMMAND on an interval. ' +
                'The command is executed via the system shell (bash/zsh), so use valid shell syntax. ' +
                'Secrets can be injected using {{SECRET_NAME}} syntax (same as http_request) — e.g. {{TELEGRAM_BOT_TOKEN}}. ' +
                'Schedule formats: "every 30s", "every 5m", "every 1h", "every 2 hours". ' +
                'The agent monitors output for urgency and alerts you if anything matches watchFor.',
            inputSchema: z.object({
                name: z.string().describe('Human-readable name for the job'),
                schedule: z.string().describe('Schedule expression, e.g. "every 30s", "every 5m", "every 1h"'),
                command: z.string().describe('Shell command to run on each tick (e.g. "curl -s https://..." or "echo hello"). Use {{SECRET_NAME}} for secrets.'),
                watchFor: z.string().describe('What to watch for in the output to flag as urgent').optional(),
            }),
            execute: async ({ name, schedule, command, watchFor }) => {
                try {
                    const job = scheduler.addJob(name, schedule, command, watchFor);
                    return `✅ Cron job created: id=${job.id}, name="${job.name}", schedule="${job.schedule}".\nCommand: ${command}\n\nThe job is now running. Use list_jobs to check status or remove_job to stop it.`;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('Cannot parse schedule')) {
                        return `❌ Invalid schedule format: "${schedule}". Use formats like "every 30s", "every 5m", "every 1h", "every 2 hours", or a plain number of seconds.`;
                    }
                    return `❌ schedule_job failed: ${msg}`;
                }
            },
        }),

        list_jobs: tool({
            description: 'List all scheduled cron jobs and their status.',
            inputSchema: z.object({}),
            execute: async () => {
                try {
                    const jobs = scheduler.listJobs();
                    if (jobs.length === 0) return 'No scheduled jobs.';

                    const lines = [`📋 **${jobs.length} cron job(s):**\n`];
                    for (const j of jobs) {
                        const statusIcon = j.active ? '▶️' : '⏸️';
                        lines.push(`${statusIcon} **${j.name}** (${j.id}) — ${j.schedule}`);
                        lines.push(`   Command: \`${j.command}\``);
                        if (j.watchFor) lines.push(`   Watch for: "${j.watchFor}"`);
                        if (j.lastRun) {
                            const ago = Math.round((Date.now() - new Date(j.lastRun.at).getTime()) / 1000);
                            lines.push(`   Last run: ${ago}s ago ${j.lastRun.urgent ? '🚨 URGENT' : '✅'} — ${j.lastRun.output.slice(0, 100)}`);
                        }
                        lines.push('');
                    }
                    return lines.join('\n');
                } catch (err) {
                    return `❌ list_jobs failed: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        }),

        remove_job: tool({
            description: 'Remove a scheduled cron job by its ID.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to remove') }),
            execute: async ({ jobId }) => {
                try {
                    return scheduler.removeJob(jobId) ? `✅ Job ${jobId} removed.` : `❌ Job ${jobId} not found. Use list_jobs to see available jobs.`;
                } catch (err) {
                    return `❌ remove_job failed: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        }),

        pause_job: tool({
            description: 'Pause a scheduled cron job without deleting it.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to pause') }),
            execute: async ({ jobId }) => {
                try {
                    return scheduler.pauseJob(jobId) ? `⏸️ Job ${jobId} paused.` : `❌ Job ${jobId} not found.`;
                } catch (err) {
                    return `❌ pause_job failed: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        }),

        resume_job: tool({
            description: 'Resume a paused cron job.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to resume') }),
            execute: async ({ jobId }) => {
                try {
                    return scheduler.resumeJob(jobId) ? `▶️ Job ${jobId} resumed.` : `❌ Job ${jobId} not found.`;
                } catch (err) {
                    return `❌ resume_job failed: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        }),
    };
}
