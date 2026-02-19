/**
 * Agent Factories — constructor helpers for creating subsystems.
 * Keeps the Agent constructor focused on wiring, not configuration.
 */

import { generateTextQuiet } from '../llm/retry';
import { LLMClient } from '../llm/client';
import { ModelRouter } from '../llm/router';
import { MemoryManager } from '../memory';
import { Scheduler, type CronAlert } from '../scheduler';
import { exec } from 'child_process';
import { getShell, unescapeShellCommand } from '../utils/shell';
import { resolve as resolvePath } from 'path';
import { AGENT_ROOT } from '../paths';
import { getConfig } from '../config';

/** Create a configured MemoryManager connected to the Forkscout Memory MCP Server */
export function createMemoryManager(_llm: LLMClient, _router: ModelRouter): MemoryManager {
    const storagePath = resolvePath(AGENT_ROOT, '.forkscout');
    const config = getConfig();
    const mcpUrl = config.agent.forkscoutMemoryMcpUrl || process.env.MEMORY_MCP_URL;

    return new MemoryManager({
        storagePath,
        ownerName: config.agent.owner,
        recentWindowSize: 6,
        contextBudget: 4000,
        mcpUrl,
    });
}

/** Create a Scheduler with shell command runner + LLM urgency evaluator */
export function createScheduler(router: ModelRouter, onUrgent: (alert: CronAlert) => void): Scheduler {
    const persistPath = resolvePath(AGENT_ROOT, '.forkscout', 'scheduler-jobs.json');

    const scheduler = new Scheduler(
        // Command runner — unescape HTML entities LLMs may inject
        (command: string) =>
            new Promise((resolve, reject) => {
                const safeCmd = unescapeShellCommand(command);
                exec(
                    safeCmd,
                    { timeout: 30_000, maxBuffer: 1024 * 1024, shell: getShell() },
                    (error: Error | null, stdout: string, stderr: string) => {
                        if (error && !stdout && !stderr) reject(error);
                        else resolve((stdout || '').trim() + (stderr ? `\n[stderr]: ${stderr.trim()}` : ''));
                    },
                );
            }),
        // Urgency evaluator
        async (jobName: string, watchFor: string | undefined, output: string) => {
            if (!watchFor) return 'normal';
            try {
                const response = await generateTextQuiet({
                    model: router.getModel('classify').model,
                    system: 'You are a classification bot. Reply with exactly one word.',
                    prompt: `A cron job named "${jobName}" just ran.\nWatch for: "${watchFor}"\n\nOutput:\n${output.slice(0, 1500)}\n\nClassify as exactly one word: normal, important, or urgent`,
                });
                const level = response.trim().toLowerCase();
                return level === 'urgent' || level === 'important' ? (level as any) : 'normal';
            } catch (err) {
                console.warn(`[Scheduler]: Urgency evaluation failed for "${jobName}": ${err instanceof Error ? err.message : err}`);
                return 'normal';
            }
        },
        persistPath,
    );

    // Restore previously-persisted cron jobs
    scheduler
        .restoreJobs()
        .catch((err) =>
            console.error(`⚠️ Scheduler restore failed: ${err instanceof Error ? err.message : String(err)}`),
        );

    // Listen for urgent alerts
    scheduler.on('urgent', onUrgent);

    return scheduler;
}
