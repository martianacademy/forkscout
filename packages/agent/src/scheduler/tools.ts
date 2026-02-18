/**
 * Scheduler tools — AI-callable cron job management tools.
 *
 * Provides 5 tools for the agent: schedule_job, list_jobs,
 * remove_job, pause_job, resume_job. Uses Zod schemas for
 * AI SDK v6 tool definitions.
 *
 * @module scheduler/tools
 */

import { z } from 'zod';
import type { Scheduler } from './scheduler';

export function createCronTools(scheduler: Scheduler) {
    const scheduleJobTool = {
        name: 'schedule_job',
        description: 'Schedule a recurring cron job. The job runs a shell command on a schedule and the agent monitors its output for urgency. Use formats like "every 30s", "every 5m", "every 1h".',
        parameters: z.object({
            name: z.string().describe('Human-readable name for the job'),
            schedule: z.string().describe('Schedule expression, e.g. "every 30s", "every 5m", "every 1h"'),
            command: z.string().describe('Shell command to run on each tick'),
            watchFor: z.string().describe('What to watch for in the output to flag as urgent, e.g. "error", "price above 100000", "disk usage above 90%"').optional(),
        }),
        async execute(params: {
            name: string;
            schedule: string;
            command: string;
            watchFor?: string;
        }): Promise<string> {
            const job = scheduler.addJob(params.name, params.schedule, params.command, params.watchFor);
            return `Cron job created: id=${job.id}, name="${job.name}", schedule="${job.schedule}", command="${job.command}"${job.watchFor ? `, watching for: "${job.watchFor}"` : ''}`;
        },
    };

    const listJobsTool = {
        name: 'list_jobs',
        description: 'List all scheduled cron jobs and their status.',
        parameters: z.object({}),
        async execute(): Promise<any> {
            const jobs = scheduler.listJobs();
            if (jobs.length === 0) return 'No scheduled jobs.';
            return jobs.map(j => ({
                id: j.id,
                name: j.name,
                schedule: j.schedule,
                command: j.command,
                active: j.active,
                watchFor: j.watchFor,
                lastRun: j.lastRun,
            }));
        },
    };

    const removeJobTool = {
        name: 'remove_job',
        description: 'Remove a scheduled cron job by its ID.',
        parameters: z.object({
            jobId: z.string().describe('The job ID to remove (e.g. "cron_1")'),
        }),
        async execute(params: { jobId: string }): Promise<string> {
            const removed = scheduler.removeJob(params.jobId);
            return removed ? `Job ${params.jobId} removed.` : `Job ${params.jobId} not found.`;
        },
    };

    const pauseJobTool = {
        name: 'pause_job',
        description: 'Pause a scheduled cron job without deleting it.',
        parameters: z.object({
            jobId: z.string().describe('The job ID to pause'),
        }),
        async execute(params: { jobId: string }): Promise<string> {
            return scheduler.pauseJob(params.jobId) ? `Job ${params.jobId} paused.` : `Job ${params.jobId} not found.`;
        },
    };

    const resumeJobTool = {
        name: 'resume_job',
        description: 'Resume a paused cron job.',
        parameters: z.object({
            jobId: z.string().describe('The job ID to resume'),
        }),
        async execute(params: { jobId: string }): Promise<string> {
            return scheduler.resumeJob(params.jobId) ? `Job ${params.jobId} resumed.` : `Job ${params.jobId} not found.`;
        },
    };

    return [scheduleJobTool, listJobsTool, removeJobTool, pauseJobTool, resumeJobTool];
}
