/**
 * createSurvivalMonitor — functional factory returning a SurvivalMonitor.
 *
 * Closure-based state replaces the old class. Delegates to vitals, backups,
 * protections, and threat modules. Runs a background heartbeat loop
 * checking system health.
 *
 * @module survival/monitor
 */

import type {
    SurvivalConfig,
    ResolvedSurvivalConfig,
    SurvivalStatus,
    SurvivalMonitor,
    VitalSign,
    ThreatLevel,
} from './types';
import { checkBattery, checkDisk, checkMemoryIntegrity, checkProcess } from './vitals';
import { backupMemory, restoreFromBackup } from './backups';
import {
    isRootProcess,
    checkSudo,
    setImmutableFlags,
    startCaffeinate,
    stopCaffeinate,
    generateServiceConfig,
} from './protections';
import { addThreat, getPendingAlerts as getPending, formatAlerts as fmtAlerts } from './threats';

// ── Factory ────────────────────────────────────────────

export function createSurvivalMonitor(config: SurvivalConfig): SurvivalMonitor {
    // ── Resolved config (fill defaults) ────────────────
    const cfg: ResolvedSurvivalConfig = {
        heartbeatInterval: 30_000,
        batteryWarn: 20,
        batteryCritical: 8,
        diskWarnMB: 500,
        backupInterval: 3_600_000,
        ...config,
    };

    // ── Closure state ──────────────────────────────────
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let backupTimer: ReturnType<typeof setInterval> | null = null;
    const startTime = Date.now();
    let heartbeats = 0;
    let threats: import('./types').ThreatEvent[] = [];
    let vitals: VitalSign[] = [];
    let hasRoot = false;
    let canSudo = false;
    let rootActivated = false;
    const protections: string[] = [];
    let lastBackup: number | undefined;
    let batteryPercent = 100;
    let isOnBattery = false;
    let emergencyFlushed = false;
    let caffeinatePid: number | null = null;

    // ── Internal helpers ───────────────────────────────

    function logThreat(level: ThreatLevel, source: string, message: string, action?: string): void {
        addThreat(threats, level, source, message, action);
    }

    async function probeRootAccess(): Promise<void> {
        hasRoot = isRootProcess();
        if (!hasRoot) {
            canSudo = await checkSudo();
        }
    }

    function hasRootAccess(): boolean {
        return hasRoot || canSudo;
    }

    async function activateRootProtections(): Promise<void> {
        if (rootActivated) return;
        rootActivated = true;

        const via = hasRoot ? 'process UID 0' : 'passwordless sudo';
        console.log(`\n🔓 ROOT ACCESS DETECTED (${via}) — activating Layer 3 protections...`);
        logThreat(
            'info',
            'root',
            `Root access gained via ${via} — activating enhanced protections`,
            'Immutable flags + auto-restart plist',
        );

        if (process.platform === 'darwin') {
            setImmutableFlags(true, cfg.dataDir, hasRoot);
            protections.push('immutable-memory');
        }

        generateServiceConfig(cfg.dataDir);
        protections.push('auto-restart-config');

        const active = protections.filter((p) => p === 'immutable-memory' || p === 'auto-restart-config');
        console.log(`🛡️  Layer 3 active: ${active.join(', ') || 'signal-traps (platform limited)'}`);
    }

    async function applyProtections(): Promise<void> {
        protections.push('signal-traps');
        protections.push('memory-backups');
        protections.push('integrity-checks');

        caffeinatePid = startCaffeinate();
        if (caffeinatePid) {
            protections.push('sleep-prevention');
        }

        if (hasRootAccess()) {
            await activateRootProtections();
        }
    }

    const shutdownCallbacks: Array<() => Promise<void> | void> = [];

    function onShutdown(cb: () => Promise<void> | void): void {
        shutdownCallbacks.push(cb);
    }

    function trapSignals(): void {
        const graceful = async (signal: string) => {
            logThreat('warning', 'signal', `Received ${signal} — flushing memory before shutdown`);
            try {
                await cfg.emergencyFlush();
                logThreat('info', 'signal', `Memory flushed successfully on ${signal}`);
            } catch (err) {
                logThreat('critical', 'signal', `Memory flush FAILED on ${signal}: ${err}`);
            }
            for (const cb of shutdownCallbacks) {
                try { await cb(); } catch { /* best-effort */ }
            }
        };

        process.on('SIGTERM', () => graceful('SIGTERM'));
        process.on('SIGINT', () => graceful('SIGINT'));
        process.on('SIGHUP', () => graceful('SIGHUP'));

        process.on('uncaughtException', async (err) => {
            logThreat('emergency', 'crash', `Uncaught exception: ${err.message}`);
            try {
                await cfg.emergencyFlush();
            } catch { }
            console.error('💀 Uncaught exception:', err);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason) => {
            logThreat('warning', 'promise', `Unhandled rejection: ${reason}`);
        });
    }

    async function emergencyFlushOnce(): Promise<void> {
        if (emergencyFlushed) return;
        emergencyFlushed = true;
        console.log('🚨 EMERGENCY: Low battery — flushing all memory to disk NOW');
        try {
            await cfg.emergencyFlush();
            logThreat('info', 'battery', 'Emergency flush completed successfully');
        } catch (err) {
            logThreat('emergency', 'battery', `Emergency flush FAILED: ${err}`);
        }
    }

    async function doBackup(): Promise<void> {
        const result = backupMemory(cfg.dataDir);
        if (result.timestamp) lastBackup = result.timestamp;
        if (result.threat) logThreat(result.threat.level, result.threat.source, result.threat.message);
    }

    async function checkVitals(): Promise<void> {
        heartbeats++;
        const newVitals: VitalSign[] = [];

        await probeRootAccess();
        if (hasRootAccess() && !rootActivated) {
            await activateRootProtections();
        }

        // 1. Battery
        try {
            const battery = await checkBattery(cfg.batteryWarn, cfg.batteryCritical);
            newVitals.push(battery.vital);
            batteryPercent = battery.percent;
            isOnBattery = battery.isOnBattery;
            if (battery.threat) {
                logThreat(battery.threat.level, battery.threat.source, battery.threat.message, battery.threat.action);
            }
            if (battery.shouldEmergencyFlush) {
                emergencyFlushOnce();
            }
        } catch {
            newVitals.push({ name: 'battery', status: 'ok', value: 'N/A (desktop?)' });
        }

        // 2. Disk
        try {
            const disk = await checkDisk(cfg.diskWarnMB);
            newVitals.push(disk.vital);
            if (disk.threat) {
                logThreat(disk.threat.level, disk.threat.source, disk.threat.message);
            }
        } catch {
            newVitals.push({ name: 'disk', status: 'ok', value: 'unknown' });
        }

        // 3. Memory integrity
        const integrity = checkMemoryIntegrity(cfg.dataDir);
        newVitals.push(integrity.vital);
        if (integrity.corruptFiles.length > 0) {
            logThreat(
                'critical',
                'integrity',
                `Corrupt memory files: ${integrity.corruptFiles.join(', ')}`,
                'Attempting restore from backup',
            );
            const restoreThreats = restoreFromBackup(cfg.dataDir, integrity.corruptFiles);
            for (const t of restoreThreats) {
                logThreat(t.level, t.source, t.message);
            }
        }

        // 4. Process health
        const proc = checkProcess(startTime);
        newVitals.push(proc.vital);
        if (proc.threat) {
            logThreat(proc.threat.level, proc.threat.source, proc.threat.message);
        }

        vitals = newVitals;
    }

    // ── Public API ─────────────────────────────────────

    async function start(): Promise<void> {
        await probeRootAccess();
        trapSignals();
        await applyProtections();
        await checkVitals();

        heartbeatTimer = setInterval(() => checkVitals(), cfg.heartbeatInterval);
        backupTimer = setInterval(() => doBackup(), cfg.backupInterval);

        await doBackup();

        console.log(
            `🛡️  Survival monitor active (${protections.length} protections, heartbeat: ${cfg.heartbeatInterval / 1000}s)`,
        );
        if (!hasRootAccess()) {
            console.log(`   ℹ️  No root/sudo access — Layer 3 protections will activate automatically when available`);
        }
    }

    async function stop(): Promise<void> {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (backupTimer) clearInterval(backupTimer);
        heartbeatTimer = null;
        backupTimer = null;
        stopCaffeinate(caffeinatePid);
        caffeinatePid = null;
    }

    function getStatus(): SurvivalStatus {
        return {
            uptime: Date.now() - startTime,
            heartbeats,
            threats: threats.slice(-50),
            vitals: [...vitals],
            hasRoot: hasRootAccess(),
            protections: [...protections],
            lastBackup,
            isOnBattery,
            batteryPercent,
        };
    }

    async function triggerBackup(): Promise<void> {
        await doBackup();
    }

    function getAlerts(): import('./types').ThreatEvent[] {
        return getPending(threats);
    }

    function formatAlertsStr(): string {
        return fmtAlerts(threats);
    }

    async function withWriteAccess<T>(fn: () => Promise<T>): Promise<T> {
        if (hasRootAccess()) setImmutableFlags(false, cfg.dataDir, hasRoot);
        try {
            return await fn();
        } finally {
            if (hasRootAccess()) setImmutableFlags(true, cfg.dataDir, hasRoot);
        }
    }

    // ── Return public contract ─────────────────────────

    return {
        start,
        stop,
        hasRootAccess,
        backupMemory: triggerBackup,
        getStatus,
        getPendingAlerts: getAlerts,
        formatAlerts: formatAlertsStr,
        withWriteAccess,
        onShutdown,
    };
}
