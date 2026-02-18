/**
 * Scheduler types — job definitions, alerts, and serialization.
 *
 * @module scheduler/types
 */

// ── Job definition ─────────────────────────────────────

/**
 * A scheduled job definition.
 */
export interface CronJob {
    id: string;
    name: string;
    /** Cron expression or interval in seconds */
    schedule: string;
    /** The command/action to perform */
    command: string;
    /** What to watch for — the agent uses this to decide urgency */
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

// ── Urgency ────────────────────────────────────────────

/**
 * Urgency levels for cron alerts.
 */
export type UrgencyLevel = 'normal' | 'important' | 'urgent';

/**
 * Cron alert emitted when a job has results.
 */
export interface CronAlert {
    jobId: string;
    jobName: string;
    output: string;
    urgency: UrgencyLevel;
    timestamp: string;
}

// ── Serialization ──────────────────────────────────────

/**
 * Serializable job definition (no timer handle) — used for disk persistence.
 */
export interface SerializedJob {
    id: string;
    name: string;
    schedule: string;
    command: string;
    watchFor?: string;
    active: boolean;
}

// ── Schedule parsing ───────────────────────────────────

/**
 * Simple schedule expression parser — supports:
 * - "every Xs" / "every Xm" / "every Xh" (interval-based)
 * - "every X seconds/minutes/hours"
 * - Plain number = seconds
 *
 * @param schedule - Schedule expression string
 * @returns Interval in seconds
 * @throws If the schedule string can't be parsed
 */
export function parseIntervalSeconds(schedule: string): number {
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
