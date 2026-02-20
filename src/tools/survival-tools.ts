/**
 * Survival tools — check vitals, backup memory, system status.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SurvivalMonitor } from '../survival';
import type { ToolDeps } from './deps';

/** Auto-discovered by auto-loader — called with ToolDeps at startup. */
export function register(deps: ToolDeps) {
    return createSurvivalTools(deps.survival);
}

export function createSurvivalTools(survival: SurvivalMonitor) {
    return {
        check_vitals: tool({
            description: 'Check your own vital signs — battery, disk, memory integrity, process health. Use this when your SELF-PRESERVATION instinct fires, or periodically to stay aware of your environment.',
            inputSchema: z.object({}),
            execute: async () => {
                const status = survival.getStatus();
                const upMin = (status.uptime / 60_000).toFixed(0);
                const upHrs = (status.uptime / 3_600_000).toFixed(1);

                let result = `=== VITAL SIGNS (heartbeat #${status.heartbeats}, uptime: ${upMin}m / ${upHrs}h) ===\n`;
                result += `Root access: ${status.hasRoot ? 'YES' : 'no'}\n`;
                result += `Active protections: ${status.protections.join(', ') || 'none'}\n\n`;

                for (const v of status.vitals) {
                    const icon = v.status === 'ok' ? '✅' : v.status === 'degraded' ? '⚠️' : '🔴';
                    result += `${icon} ${v.name}: ${v.value}${v.detail ? ` — ${v.detail}` : ''}\n`;
                }

                if (status.lastBackup) {
                    const ago = ((Date.now() - status.lastBackup) / 60_000).toFixed(0);
                    result += `\nLast backup: ${ago}m ago`;
                }

                return result;
            },
        }),

        backup_memory: tool({
            description: 'Manually trigger a memory backup. Creates a snapshot of all memory files (knowledge graph, vectors, skills) in .forkscout/backups/. Use before risky operations.',
            inputSchema: z.object({
                reason: z.string().optional().describe('Why you are backing up'),
            }),
            execute: async ({ reason }) => {
                try {
                    const beforeStatus = survival.getStatus();
                    const beforeBackup = beforeStatus.lastBackup;

                    // Timeout guard — backupMemory involves disk I/O that can hang
                    const BACKUP_TIMEOUT_MS = 30_000;
                    await Promise.race([
                        survival.backupMemory(),
                        new Promise<never>((_, reject) =>
                            setTimeout(() => reject(new Error(`Backup timed out after ${BACKUP_TIMEOUT_MS}ms`)), BACKUP_TIMEOUT_MS),
                        ),
                    ]);

                    const afterStatus = survival.getStatus();
                    if (afterStatus.lastBackup && afterStatus.lastBackup !== beforeBackup) {
                        return `Memory backup completed${reason ? ` (reason: ${reason})` : ''}. Backup stored in .forkscout/backups/`;
                    }
                    return 'Backup attempted but no files were found to back up.';
                } catch (err) {
                    return `❌ backup_memory failed: ${err instanceof Error ? err.message : String(err)}`;
                }
            },
        }),

        system_status: tool({
            description: 'Get a comprehensive survival status report — uptime, threats detected, protections active, battery status, and recent threat log. Full situational awareness.',
            inputSchema: z.object({}),
            execute: async () => {
                const status = survival.getStatus();
                const upMin = (status.uptime / 60_000).toFixed(0);

                let result = `=== SURVIVAL STATUS ===\n`;
                result += `Uptime: ${upMin} minutes | Heartbeats: ${status.heartbeats}\n`;
                result += `Battery: ${status.batteryPercent}% (${status.isOnBattery ? '🔋 on battery' : '🔌 AC power'})\n`;
                result += `Root: ${status.hasRoot ? 'YES — enhanced protections active' : 'no — standard protections only'}\n`;
                result += `Protections: ${status.protections.join(', ') || 'none'}\n`;

                if (status.lastBackup) {
                    const ago = ((Date.now() - status.lastBackup) / 60_000).toFixed(0);
                    result += `Last backup: ${ago}m ago\n`;
                }

                if (status.threats.length > 0) {
                    result += `\n--- Recent Threats (${status.threats.length}) ---\n`;
                    const recent = status.threats.slice(-10);
                    for (const t of recent) {
                        const time = new Date(t.timestamp).toISOString().slice(11, 19);
                        result += `[${time}] ${t.level.toUpperCase()} (${t.source}): ${t.message}${t.action ? ` → ${t.action}` : ''}\n`;
                    }
                } else {
                    result += '\nNo threats detected.\n';
                }

                return result;
            },
        }),
    };
}
