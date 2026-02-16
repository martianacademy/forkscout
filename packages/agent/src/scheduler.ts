import { z } from 'zod';
import { EventEmitter } from 'events';

/**
 * A scheduled job definition
 */
export interface CronJob {
    id: string;
    name: string;
    /** Cron expression or interval in seconds */
    schedule: string;
    /** The command/action to perform */
    command: string;
    /** What to watch for - the agent uses this to decide urgency */
    watchFor?: string;
    /** Whether the job is currently active */
    active: boolean;
    /** Last run info */
    lastRun?: {
        at: string;
        output: string;
        urgent: boolean;
    };
    /** Internal timer handle */
    _timer?: ReturnType<typeof setInterval>;
}

/**
 * Urgency levels for cron alerts
 */
export type UrgencyLevel = 'normal' | 'important' | 'urgent';

/**
 * Cron alert emitted when a job has results
 */
export interface CronAlert {
    jobId: string;
    jobName: string;
    output: string;
    urgency: UrgencyLevel;
    timestamp: string;
}

/**
 * Simple cron expression parser - supports:
 * - "every Xs" / "every Xm" / "every Xh" (interval-based)
 * - "every X seconds/minutes/hours"
 */
function parseIntervalSeconds(schedule: string): number {
    const s = schedule.toLowerCase().trim();

    // "every 30s", "every 5m", "every 1h"
    const shortMatch = s.match(/^every\s+(\d+)\s*(s|m|h)$/);
    if (shortMatch) {
        const val = parseInt(shortMatch[1]);
        switch (shortMatch[2]) {
            case 's': return val;
            case 'm': return val * 60;
            case 'h': return val * 3600;
        }
    }

    // "every 30 seconds", "every 5 minutes", "every 1 hour(s)"
    const longMatch = s.match(/^every\s+(\d+)\s+(second|minute|hour)s?$/);
    if (longMatch) {
        const val = parseInt(longMatch[1]);
        switch (longMatch[2]) {
            case 'second': return val;
            case 'minute': return val * 60;
            case 'hour': return val * 3600;
        }
    }

    // Plain number = seconds
    const plain = parseInt(s);
    if (!isNaN(plain)) return plain;

    throw new Error(`Cannot parse schedule: "${schedule}". Use format like "every 30s", "every 5m", "every 1h", or a number of seconds.`);
}

/**
 * Scheduler - manages background cron jobs that the agent can create and monitor
 */
export class Scheduler extends EventEmitter {
    private jobs = new Map<string, CronJob>();
    private idCounter = 0;
    /** Callback to run a command (injected from the agent) */
    private commandRunner: (command: string) => Promise<string>;
    /** Callback to evaluate urgency (injected from the agent) */
    private urgencyEvaluator: (jobName: string, watchFor: string | undefined, output: string) => Promise<UrgencyLevel>;

    constructor(
        commandRunner: (command: string) => Promise<string>,
        urgencyEvaluator: (jobName: string, watchFor: string | undefined, output: string) => Promise<UrgencyLevel>,
    ) {
        super();
        this.commandRunner = commandRunner;
        this.urgencyEvaluator = urgencyEvaluator;
    }

    addJob(name: string, schedule: string, command: string, watchFor?: string): CronJob {
        const id = `cron_${++this.idCounter}`;
        const intervalSec = parseIntervalSeconds(schedule);

        const job: CronJob = {
            id,
            name,
            schedule,
            command,
            watchFor,
            active: true,
        };

        // Set up the repeating timer
        job._timer = setInterval(async () => {
            if (!job.active) return;

            try {
                console.log(`\n⏰ [Cron ${job.name}]: Running "${job.command}"...`);
                const output = await this.commandRunner(job.command);

                // Evaluate urgency
                const urgency = await this.urgencyEvaluator(job.name, job.watchFor, output);

                job.lastRun = {
                    at: new Date().toISOString(),
                    output: output.slice(0, 2000),
                    urgent: urgency === 'urgent',
                };

                const alert: CronAlert = {
                    jobId: job.id,
                    jobName: job.name,
                    output: output.slice(0, 2000),
                    urgency,
                    timestamp: new Date().toISOString(),
                };

                this.emit('result', alert);

                if (urgency === 'urgent') {
                    this.emit('urgent', alert);
                }

                const icon = urgency === 'urgent' ? '🚨' : urgency === 'important' ? '⚠️' : '✅';
                console.log(`${icon} [Cron ${job.name}]: ${urgency.toUpperCase()} — ${output.slice(0, 200)}`);
            } catch (err) {
                console.error(`❌ [Cron ${job.name}]: Error — ${err instanceof Error ? err.message : String(err)}`);
            }
        }, intervalSec * 1000);

        this.jobs.set(id, job);
        console.log(`📅 Cron job registered: "${name}" (${schedule}) — ${command}`);
        return job;
    }

    removeJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        if (job._timer) clearInterval(job._timer);
        job.active = false;
        this.jobs.delete(id);
        console.log(`🗑️ Cron job removed: "${job.name}"`);
        return true;
    }

    pauseJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        job.active = false;
        console.log(`⏸️ Cron job paused: "${job.name}"`);
        return true;
    }

    resumeJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        job.active = true;
        console.log(`▶️ Cron job resumed: "${job.name}"`);
        return true;
    }

    listJobs(): Array<Omit<CronJob, '_timer'>> {
        return Array.from(this.jobs.values()).map(({ _timer, ...rest }) => rest);
    }

    getJob(id: string): Omit<CronJob, '_timer'> | undefined {
        const job = this.jobs.get(id);
        if (!job) return undefined;
        const { _timer, ...rest } = job;
        return rest;
    }

    stopAll(): void {
        for (const [id] of this.jobs) {
            this.removeJob(id);
        }
    }
}

// ── Cron Tools for the agent ──

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
