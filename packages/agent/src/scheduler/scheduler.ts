/**
 * Scheduler — manages background cron jobs the agent can create and monitor.
 *
 * The scheduler runs commands on intervals and evaluates their output
 * for urgency. Urgent results get injected into the next chat turn.
 * Jobs persist to disk so they survive restarts.
 *
 * @module scheduler/scheduler
 */

import { EventEmitter } from 'events';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { CronJob, CronAlert, UrgencyLevel, SerializedJob } from './types';
import { parseIntervalSeconds } from './types';

export class Scheduler extends EventEmitter {
    private jobs = new Map<string, CronJob>();
    private idCounter = 0;
    /** Callback to run a command (injected from the agent) */
    private commandRunner: (command: string) => Promise<string>;
    /** Callback to evaluate urgency (injected from the agent) */
    private urgencyEvaluator: (jobName: string, watchFor: string | undefined, output: string) => Promise<UrgencyLevel>;
    /** Path to persist jobs (e.g. .forkscout/scheduler-jobs.json) */
    private persistPath?: string;

    constructor(
        commandRunner: (command: string) => Promise<string>,
        urgencyEvaluator: (jobName: string, watchFor: string | undefined, output: string) => Promise<UrgencyLevel>,
        persistPath?: string,
    ) {
        super();
        this.commandRunner = commandRunner;
        this.urgencyEvaluator = urgencyEvaluator;
        this.persistPath = persistPath;
    }

    /**
     * Restore previously-persisted jobs from disk.
     * Called once during startup after the scheduler is constructed.
     */
    async restoreJobs(): Promise<number> {
        if (!this.persistPath) return 0;
        try {
            const raw = await readFile(this.persistPath, 'utf-8');
            const saved: SerializedJob[] = JSON.parse(raw);
            let restored = 0;
            for (const j of saved) {
                try {
                    this.addJob(j.name, j.schedule, j.command, j.watchFor);
                    if (!j.active) {
                        // Restore paused state
                        const latest = Array.from(this.jobs.values()).pop();
                        if (latest) latest.active = false;
                    }
                    restored++;
                } catch (err) {
                    console.error(`⚠️ Failed to restore cron job "${j.name}": ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            if (restored > 0) console.log(`📂 Restored ${restored} cron job(s) from disk`);
            return restored;
        } catch {
            // No saved jobs or parse error — that's fine
            return 0;
        }
    }

    /** Persist current job definitions to disk (fire-and-forget). */
    private async persistJobs(): Promise<void> {
        if (!this.persistPath) return;
        const serialized: SerializedJob[] = Array.from(this.jobs.values()).map(({ id, name, schedule, command, watchFor, active }) => ({
            id, name, schedule, command, watchFor, active,
        }));
        try {
            await mkdir(dirname(this.persistPath), { recursive: true });
            await writeFile(this.persistPath, JSON.stringify(serialized, null, 2), 'utf-8');
        } catch (err) {
            console.error(`⚠️ Failed to persist cron jobs: ${err instanceof Error ? err.message : String(err)}`);
        }
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
        this.persistJobs();
        return job;
    }

    removeJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        if (job._timer) clearInterval(job._timer);
        job.active = false;
        this.jobs.delete(id);
        console.log(`🗑️ Cron job removed: "${job.name}"`);
        this.persistJobs();
        return true;
    }

    pauseJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        job.active = false;
        console.log(`⏸️ Cron job paused: "${job.name}"`);
        this.persistJobs();
        return true;
    }

    resumeJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        job.active = true;
        console.log(`▶️ Cron job resumed: "${job.name}"`);
        this.persistJobs();
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
