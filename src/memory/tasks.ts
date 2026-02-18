/**
 * Task Manager — executive memory for tracking active goals.
 * Prevents runaway loops by giving the agent temporal continuity:
 * "Am I already doing this? How long have I been at it?"
 * @module memory/tasks
 */

import type { ActiveTask, TaskStatus } from './types';
import { TASK_MAX_DURATION_MS } from './types';

export class TaskManager {
    private tasks: ActiveTask[] = [];
    private dirty = false;

    /** Load tasks from persisted data. */
    load(tasks: ActiveTask[]): void {
        this.tasks = tasks ?? [];
        this.expireStale();
    }

    /** Return snapshot for persistence. */
    snapshot(): ActiveTask[] {
        return this.tasks;
    }

    /** Mark dirty state was consumed. */
    isDirty(): boolean { return this.dirty; }
    clearDirty(): void { this.dirty = false; }

    // ── CRUD ─────────────────────────────────────────

    create(title: string, goal: string, opts?: {
        budgetRemaining?: number;
        successCondition?: string;
    }): ActiveTask {
        // Check for similar running task first
        const similar = this.findSimilar(title, goal);
        if (similar && similar.status === 'running') {
            similar.lastStepAt = Date.now();
            this.dirty = true;
            return similar;
        }

        const task: ActiveTask = {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title,
            goal,
            status: 'running',
            startedAt: Date.now(),
            lastStepAt: Date.now(),
            budgetRemaining: opts?.budgetRemaining,
            successCondition: opts?.successCondition,
        };
        this.tasks.push(task);
        this.dirty = true;
        return task;
    }

    get(id: string): ActiveTask | undefined {
        return this.tasks.find(t => t.id === id);
    }

    getAll(): ActiveTask[] { return this.tasks; }

    getByStatus(status: TaskStatus): ActiveTask[] {
        return this.tasks.filter(t => t.status === status);
    }

    update(id: string, patch: Partial<Pick<ActiveTask, 'status' | 'lastStepAt' | 'budgetRemaining' | 'stopReason'>>): ActiveTask | undefined {
        const task = this.tasks.find(t => t.id === id);
        if (!task) return undefined;
        Object.assign(task, patch, { lastStepAt: Date.now() });
        this.dirty = true;
        return task;
    }

    complete(id: string, reason?: string): ActiveTask | undefined {
        return this.update(id, { status: 'completed', stopReason: reason ?? 'completed' });
    }

    abort(id: string, reason?: string): ActiveTask | undefined {
        return this.update(id, { status: 'aborted', stopReason: reason ?? 'aborted' });
    }

    pause(id: string): ActiveTask | undefined {
        return this.update(id, { status: 'paused' });
    }

    resume(id: string): ActiveTask | undefined {
        return this.update(id, { status: 'running' });
    }

    /** Touch a running task to show progress. */
    heartbeat(id: string): void {
        const task = this.tasks.find(t => t.id === id);
        if (task && task.status === 'running') {
            task.lastStepAt = Date.now();
            this.dirty = true;
        }
    }

    // ── Smart logic ──────────────────────────────────

    /**
     * Find a task with similar title or goal (fuzzy match).
     * Core rule: before starting any long process, check if a similar
     * active task already exists to prevent duplicate work.
     */
    findSimilar(title: string, goal: string): ActiveTask | undefined {
        const titleL = title.toLowerCase();
        const goalL = goal.toLowerCase();
        const titleTerms = titleL.split(/\s+/).filter(t => t.length > 2);
        const goalTerms = goalL.split(/\s+/).filter(t => t.length > 2);

        let best: { task: ActiveTask; score: number } | undefined;

        for (const task of this.tasks) {
            if (task.status === 'completed' || task.status === 'aborted') continue;
            let score = 0;
            const tL = task.title.toLowerCase();
            const gL = task.goal.toLowerCase();

            // Title match
            if (tL === titleL) score += 10;
            else {
                for (const term of titleTerms) {
                    if (tL.includes(term)) score += 2;
                }
            }

            // Goal match
            for (const term of goalTerms) {
                if (gL.includes(term)) score += 1;
            }

            if (score >= 4 && (!best || score > best.score)) {
                best = { task, score };
            }
        }

        return best?.task;
    }

    /**
     * Auto-expire tasks that have been running too long.
     * Prevents infinite self-optimization loops.
     */
    expireStale(maxDurationMs = TASK_MAX_DURATION_MS): number {
        const now = Date.now();
        let expired = 0;
        for (const task of this.tasks) {
            if (task.status !== 'running') continue;
            if (now - task.startedAt > maxDurationMs) {
                task.status = 'aborted';
                task.stopReason = `auto-expired after ${Math.round(maxDurationMs / 60000)}min`;
                expired++;
                this.dirty = true;
            }
        }
        return expired;
    }

    /** Prune old completed/aborted tasks (keep last 50). */
    prune(keepTerminal = 50): number {
        const terminal = this.tasks.filter(t => t.status === 'completed' || t.status === 'aborted');
        if (terminal.length <= keepTerminal) return 0;
        const toRemove = terminal
            .sort((a, b) => a.lastStepAt - b.lastStepAt)
            .slice(0, terminal.length - keepTerminal);
        const removeIds = new Set(toRemove.map(t => t.id));
        const before = this.tasks.length;
        this.tasks = this.tasks.filter(t => !removeIds.has(t.id));
        this.dirty = true;
        return before - this.tasks.length;
    }

    /** Summary string for system prompt injection. */
    summary(): string {
        const running = this.getByStatus('running');
        const paused = this.getByStatus('paused');
        if (running.length === 0 && paused.length === 0) return '';

        const lines: string[] = ['[Active Tasks]'];
        for (const t of running) {
            const elapsed = Math.round((Date.now() - t.startedAt) / 60000);
            lines.push(`▸ ${t.title} (running ${elapsed}min) — ${t.goal}`);
        }
        for (const t of paused) {
            lines.push(`▹ ${t.title} (paused) — ${t.goal}`);
        }
        return lines.join('\n');
    }

    get runningCount(): number { return this.getByStatus('running').length; }
    get totalCount(): number { return this.tasks.length; }
}
