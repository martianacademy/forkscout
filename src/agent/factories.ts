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
import { resolveTemplates, scrubSecrets } from '../tools/_helpers';
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
        recentWindowSize: 20,
        contextBudget: 8000,
        mcpUrl,
    });
}

/** Create a Scheduler with shell command runner + LLM urgency evaluator */
export function createScheduler(router: ModelRouter, onUrgent: (alert: CronAlert) => void): Scheduler {
    const persistPath = resolvePath(AGENT_ROOT, '.forkscout', 'scheduler-jobs.json');

    const scheduler = new Scheduler(
        // Command runner — resolve {{SECRET}} templates + unescape HTML entities
        (command: string) =>
            new Promise((resolve, reject) => {
                let safeCmd: string;
                try {
                    // Resolve {{SECRET_NAME}} placeholders (same syntax as http_request)
                    safeCmd = resolveTemplates(unescapeShellCommand(command));
                } catch (err) {
                    reject(new Error(`Failed to resolve command secrets: ${err instanceof Error ? err.message : String(err)}`));
                    return;
                }
                exec(
                    safeCmd,
                    { timeout: 30_000, maxBuffer: 1024 * 1024, shell: getShell() },
                    (error: Error | null, stdout: string, stderr: string) => {
                        if (error && !stdout && !stderr) reject(error);
                        else {
                            // Scrub secrets from output before returning to the LLM
                            const output = (stdout || '').trim() + (stderr ? `\n[stderr]: ${stderr.trim()}` : '');
                            resolve(scrubSecrets(output));
                        }
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
