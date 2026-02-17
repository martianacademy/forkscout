/**
 * Scheduler (cron) tools — create, list, pause, resume, remove scheduled jobs.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { Scheduler } from '../scheduler';

export function createSchedulerTools(scheduler: Scheduler) {
    return {
        schedule_job: tool({
            description: 'Schedule a recurring cron job. The job runs a shell command on a schedule and the agent monitors its output. Use formats like "every 30s", "every 5m", "every 1h".',
            inputSchema: z.object({
                name: z.string().describe('Human-readable name for the job'),
                schedule: z.string().describe('Schedule expression, e.g. "every 30s", "every 5m", "every 1h"'),
                command: z.string().describe('Shell command to run on each tick'),
                watchFor: z.string().describe('What to watch for in the output to flag as urgent').optional(),
            }),
            execute: async ({ name, schedule, command, watchFor }) => {
                const job = scheduler.addJob(name, schedule, command, watchFor);
                return `Cron job created: id=${job.id}, name="${job.name}", schedule="${job.schedule}"`;
            },
        }),

        list_jobs: tool({
            description: 'List all scheduled cron jobs and their status.',
            inputSchema: z.object({}),
            execute: async () => {
                const jobs = scheduler.listJobs();
                if (jobs.length === 0) return 'No scheduled jobs.';
                return jobs.map(j => ({
                    id: j.id, name: j.name, schedule: j.schedule,
                    command: j.command, active: j.active, watchFor: j.watchFor, lastRun: j.lastRun,
                }));
            },
        }),

        remove_job: tool({
            description: 'Remove a scheduled cron job by its ID.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to remove') }),
            execute: async ({ jobId }) => scheduler.removeJob(jobId) ? `Job ${jobId} removed.` : `Job ${jobId} not found.`,
        }),

        pause_job: tool({
            description: 'Pause a scheduled cron job without deleting it.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to pause') }),
            execute: async ({ jobId }) => scheduler.pauseJob(jobId) ? `Job ${jobId} paused.` : `Job ${jobId} not found.`,
        }),

        resume_job: tool({
            description: 'Resume a paused cron job.',
            inputSchema: z.object({ jobId: z.string().describe('The job ID to resume') }),
            execute: async ({ jobId }) => scheduler.resumeJob(jobId) ? `Job ${jobId} resumed.` : `Job ${jobId} not found.`,
        }),
    };
}
