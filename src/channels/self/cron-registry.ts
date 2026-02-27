// src/channels/self/cron-registry.ts
//
// Singleton registry of live node-cron tasks.
// Allows hot-registration and unregistration of cron jobs at runtime —
// no process restart needed.
//
// Usage:
//   setupRegistry(config, runJobFn)   — called once by startCronJobs() in index.ts
//   registerJob(job)                  — called by the tool when a job is added
//   unregisterJob(name)               — called by the tool when a job is removed,
//                                       and by runJob() after a run_once job fires
//   getScheduledJobNames()            — introspection

import cron, { type ScheduledTask } from "node-cron";
import type { AppConfig, SelfJobConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("self:cron-registry");

type JobRunner = (config: AppConfig, job: SelfJobConfig) => Promise<void>;

let _config: AppConfig | null = null;
let _runJob: JobRunner | null = null;
const _tasks = new Map<string, ScheduledTask>();

/** Called once by startCronJobs() to wire up the config and job runner. */
export function setupRegistry(config: AppConfig, runJob: JobRunner): void {
    _config = config;
    _runJob = runJob;
}

/**
 * Hot-register a job into the live scheduler.
 * Safe to call from the cron tool without a restart — the job fires on its next scheduled tick.
 * No-op if setupRegistry() hasn't been called (e.g. in terminal channel).
 */
export function registerJob(job: SelfJobConfig): { registered: boolean } {
    if (!_config || !_runJob) {
        logger.warn(`Registry not initialised — job "${job.name}" saved to file but NOT hot-registered. It will activate after the next agent restart.`);
        return { registered: false };
    }
    if (_tasks.has(job.name)) {
        logger.warn(`Job "${job.name}" is already registered in the live scheduler — skipping duplicate`);
        return { registered: true };
    }
    if (!cron.validate(job.schedule)) {
        logger.error(`Cannot register job "${job.name}": invalid cron expression "${job.schedule}"`);
        return { registered: false };
    }
    const task = cron.schedule(job.schedule, () => void _runJob!(_config!, job));
    _tasks.set(job.name, task);
    logger.info(`Hot-registered: "${job.name}" → ${job.schedule}${job.run_once ? " (run_once)" : ""}`);
    return { registered: true };
}

/**
 * Stop and remove a live scheduled task.
 * Safe to call even if the job was never hot-registered (e.g. added before setupRegistry).
 */
export function unregisterJob(name: string): void {
    const task = _tasks.get(name);
    if (!task) return;
    task.stop();
    _tasks.delete(name);
    logger.info(`Unregistered: "${name}"`);
}

/** Returns the names of all currently scheduled live tasks. */
export function getScheduledJobNames(): string[] {
    return [..._tasks.keys()];
}
