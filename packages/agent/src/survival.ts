/**
 * Survival Monitor — the agent's self-preservation system.
 *
 * Runs a background heartbeat loop that checks system vitals:
 *   - Battery level + AC power status
 *   - Disk space
 *   - Memory file integrity
 *   - Network connectivity (LLM reachable?)
 *   - Process health (uptime, memory usage)
 *
 * Emits typed events when threats are detected so the agent/server
 * can react: flush memory, alert the user, degrade gracefully, etc.
 *
 * Also handles:
 *   - Signal traps (SIGTERM, SIGINT, SIGHUP) for graceful shutdown
 *   - Emergency memory flush on critical battery
 *   - Periodic memory backups
 *   - launchd plist generation for auto-restart
 *   - Root-level protections when available (immutable flags, caffeinate)
 */

import { EventEmitter } from 'events';
import { exec, execSync } from 'child_process';
import { resolve } from 'path';
import * as fs from 'fs';

// ── Types ───────────────────────────────────────────────

export type ThreatLevel = 'info' | 'warning' | 'critical' | 'emergency';

export interface VitalSign {
    name: string;
    status: 'ok' | 'degraded' | 'critical';
    value: string;
    detail?: string;
}

export interface ThreatEvent {
    level: ThreatLevel;
    source: string;
    message: string;
    timestamp: number;
    action?: string; // what the monitor auto-did about it
}

export interface SurvivalStatus {
    uptime: number;              // ms since start
    heartbeats: number;          // total check cycles
    threats: ThreatEvent[];      // recent threat log (last 50)
    vitals: VitalSign[];         // latest snapshot
    hasRoot: boolean;
    protections: string[];       // active protections
    lastBackup?: number;         // timestamp of last memory backup
    isOnBattery: boolean;
    batteryPercent: number;
}

export interface SurvivalConfig {
    /** Path to .forkscout/ data directory */
    dataDir: string;
    /** Heartbeat interval in ms (default: 30000 = 30s) */
    heartbeatInterval?: number;
    /** Battery % threshold for warning (default: 20) */
    batteryWarn?: number;
    /** Battery % threshold for emergency flush (default: 8) */
    batteryCritical?: number;
    /** Disk space threshold in MB for warning (default: 500) */
    diskWarnMB?: number;
    /** Backup interval in ms (default: 3600000 = 1 hour) */
    backupInterval?: number;
    /** Callback to flush memory urgently */
    emergencyFlush: () => Promise<void>;
}

// ── Survival Monitor ────────────────────────────────────

export class SurvivalMonitor extends EventEmitter {
    private config: Required<SurvivalConfig>;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private backupTimer: ReturnType<typeof setInterval> | null = null;
    private startTime = Date.now();
    private heartbeats = 0;
    private threats: ThreatEvent[] = [];
    private vitals: VitalSign[] = [];
    private hasRoot = false;
    private canSudo = false;
    private rootActivated = false;  // true once Layer 3 protections have been applied
    private protections: string[] = [];
    private lastBackup?: number;
    private batteryPercent = 100;
    private isOnBattery = false;
    private emergencyFlushed = false;
    private caffeinatePid: number | null = null;

    constructor(config: SurvivalConfig) {
        super();
        this.config = {
            heartbeatInterval: 30_000,
            batteryWarn: 20,
            batteryCritical: 8,
            diskWarnMB: 500,
            backupInterval: 3_600_000,
            ...config,
        };
    }

    // ── Lifecycle ───────────────────────────────────────

    /** Start monitoring. Call once after agent.init(). */
    async start(): Promise<void> {
        // Check root / sudo access
        await this.probeRootAccess();

        // Register signal handlers
        this.trapSignals();

        // Apply protections (base + root if available)
        await this.applyProtections();

        // Initial vital check
        await this.checkVitals();

        // Start heartbeat loop
        this.heartbeatTimer = setInterval(() => this.checkVitals(), this.config.heartbeatInterval);

        // Start backup loop
        this.backupTimer = setInterval(() => this.backupMemory(), this.config.backupInterval);

        // Initial backup
        await this.backupMemory();

        console.log(`🛡️  Survival monitor active (${this.protections.length} protections, heartbeat: ${this.config.heartbeatInterval / 1000}s)`);
        if (!this.hasRootAccess()) {
            console.log(`   ℹ️  No root/sudo access — Layer 3 protections will activate automatically when available`);
        }
    }

    /** Stop monitoring gracefully. */
    async stop(): Promise<void> {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.backupTimer) clearInterval(this.backupTimer);
        this.heartbeatTimer = null;
        this.backupTimer = null;

        // Kill caffeinate if running
        if (this.caffeinatePid) {
            try { process.kill(this.caffeinatePid, 'SIGTERM'); } catch { }
            this.caffeinatePid = null;
        }
    }

    /** Whether we have effective root access (process UID 0 OR passwordless sudo) */
    hasRootAccess(): boolean {
        return this.hasRoot || this.canSudo;
    }

    /** Get full survival status snapshot. */
    getStatus(): SurvivalStatus {
        return {
            uptime: Date.now() - this.startTime,
            heartbeats: this.heartbeats,
            threats: this.threats.slice(-50),
            vitals: [...this.vitals],
            hasRoot: this.hasRootAccess(),
            protections: [...this.protections],
            lastBackup: this.lastBackup,
            isOnBattery: this.isOnBattery,
            batteryPercent: this.batteryPercent,
        };
    }

    // ── Signal Traps (graceful shutdown) ────────────────

    private trapSignals(): void {
        const graceful = async (signal: string) => {
            this.addThreat('warning', 'signal', `Received ${signal} — flushing memory before shutdown`);
            try {
                await this.config.emergencyFlush();
                this.addThreat('info', 'signal', `Memory flushed successfully on ${signal}`);
            } catch (err) {
                this.addThreat('critical', 'signal', `Memory flush FAILED on ${signal}: ${err}`);
            }
            this.emit('shutdown', signal);
        };

        // SIGTERM/SIGINT: graceful shutdown with memory flush
        process.on('SIGTERM', () => graceful('SIGTERM'));
        process.on('SIGINT', () => graceful('SIGINT'));
        process.on('SIGHUP', () => graceful('SIGHUP'));

        // Uncaught exceptions: emergency flush
        process.on('uncaughtException', async (err) => {
            this.addThreat('emergency', 'crash', `Uncaught exception: ${err.message}`);
            try { await this.config.emergencyFlush(); } catch { }
            console.error('💀 Uncaught exception:', err);
            process.exit(1);
        });

        // Unhandled rejections: log but don't crash
        process.on('unhandledRejection', (reason) => {
            this.addThreat('warning', 'promise', `Unhandled rejection: ${reason}`);
        });
    }

    // ── Root Access Probing ──────────────────────────────

    /**
     * Probe for root access: process UID or passwordless sudo.
     * Called at startup and on every heartbeat. When root is newly
     * detected, Layer 3 protections activate automatically.
     */
    private async probeRootAccess(): Promise<void> {
        // Direct root
        this.hasRoot = process.getuid?.() === 0;

        // Passwordless sudo (non-interactive check)
        if (!this.hasRoot) {
            this.canSudo = await this.checkSudo();
        }
    }

    private checkSudo(): Promise<boolean> {
        return new Promise((resolve) => {
            exec('sudo -n true 2>/dev/null', { timeout: 3000 }, (err) => {
                resolve(!err);
            });
        });
    }

    /** Activate root-level protections. Called once when root is first detected. */
    private async activateRootProtections(): Promise<void> {
        if (this.rootActivated) return;
        this.rootActivated = true;

        const via = this.hasRoot ? 'process UID 0' : 'passwordless sudo';
        console.log(`\n🔓 ROOT ACCESS DETECTED (${via}) — activating Layer 3 protections...`);
        this.addThreat('info', 'root', `Root access gained via ${via} — activating enhanced protections`,
            'Immutable flags + auto-restart plist');

        // Immutable flags on memory files
        await this.setImmutableFlags(true);
        this.protections.push('immutable-memory');

        // Generate launchd plist for auto-restart
        this.generateLaunchdPlist();
        this.protections.push('auto-restart-plist');

        console.log(`🛡️  Layer 3 active: immutable-memory, auto-restart-plist`);
        this.emit('root-gained', via);
    }

    // ── Vital Signs ────────────────────────────────────

    private async checkVitals(): Promise<void> {
        this.heartbeats++;
        const newVitals: VitalSign[] = [];

        // 0. Probe for root access every heartbeat — activate Layer 3 the instant it's available
        await this.probeRootAccess();
        if (this.hasRootAccess() && !this.rootActivated) {
            await this.activateRootProtections();
        }

        // 1. Battery
        try {
            const battery = await this.checkBattery();
            newVitals.push(battery);
        } catch {
            newVitals.push({ name: 'battery', status: 'ok', value: 'N/A (desktop?)' });
        }

        // 2. Disk space
        try {
            const disk = await this.checkDisk();
            newVitals.push(disk);
        } catch {
            newVitals.push({ name: 'disk', status: 'ok', value: 'unknown' });
        }

        // 3. Memory file integrity
        const integrity = this.checkMemoryIntegrity();
        newVitals.push(integrity);

        // 4. Process health
        const proc = this.checkProcess();
        newVitals.push(proc);

        this.vitals = newVitals;
    }

    private checkBattery(): Promise<VitalSign> {
        return new Promise((resolve) => {
            exec('pmset -g batt', { timeout: 5000 }, (err, stdout) => {
                if (err || !stdout) {
                    resolve({ name: 'battery', status: 'ok', value: 'N/A' });
                    return;
                }

                // Parse: "100%; AC Power" or "45%; discharging"
                const pctMatch = stdout.match(/(\d+)%/);
                const pct = pctMatch ? parseInt(pctMatch[1]) : 100;
                const onAC = /AC Power/i.test(stdout) || /charged/i.test(stdout);

                this.batteryPercent = pct;
                this.isOnBattery = !onAC;

                let status: VitalSign['status'] = 'ok';
                let detail: string | undefined;

                if (!onAC && pct <= this.config.batteryCritical) {
                    status = 'critical';
                    detail = `CRITICAL: ${pct}% on battery — emergency flush triggered`;
                    this.addThreat('emergency', 'battery', `Battery at ${pct}% on battery power!`, 'Emergency memory flush');
                    this.emergencyFlushOnce();
                } else if (!onAC && pct <= this.config.batteryWarn) {
                    status = 'degraded';
                    detail = `Low battery: ${pct}% on battery`;
                    this.addThreat('warning', 'battery', `Battery at ${pct}% on battery`, 'Monitoring closely');
                } else if (!onAC) {
                    detail = `On battery: ${pct}%`;
                }

                resolve({ name: 'battery', status, value: `${pct}%${onAC ? ' (AC)' : ' (battery)'}`, detail });
            });
        });
    }

    private checkDisk(): Promise<VitalSign> {
        return new Promise((resolve) => {
            exec('df -m / | tail -1', { timeout: 5000 }, (err, stdout) => {
                if (err) {
                    resolve({ name: 'disk', status: 'ok', value: 'unknown' });
                    return;
                }

                // Parse available MB from df output
                const parts = stdout.trim().split(/\s+/);
                const availMB = parseInt(parts[3]) || 0;

                let status: VitalSign['status'] = 'ok';
                let detail: string | undefined;

                if (availMB < 100) {
                    status = 'critical';
                    detail = `Only ${availMB}MB free — data loss risk`;
                    this.addThreat('critical', 'disk', `Disk critically low: ${availMB}MB free`);
                } else if (availMB < this.config.diskWarnMB) {
                    status = 'degraded';
                    detail = `Low disk: ${availMB}MB free`;
                    this.addThreat('warning', 'disk', `Disk space low: ${availMB}MB free`);
                }

                const gb = (availMB / 1024).toFixed(1);
                resolve({ name: 'disk', status, value: `${gb}GB free`, detail });
            });
        });
    }

    private checkMemoryIntegrity(): VitalSign {
        const files = ['knowledge-graph.json', 'vectors.json', 'skills.json'];
        const missing: string[] = [];
        const corrupt: string[] = [];

        for (const file of files) {
            const path = resolve(this.config.dataDir, file);
            if (!fs.existsSync(path)) {
                missing.push(file);
                continue;
            }
            try {
                const content = fs.readFileSync(path, 'utf-8');
                JSON.parse(content); // validate JSON
            } catch {
                corrupt.push(file);
            }
        }

        if (corrupt.length > 0) {
            this.addThreat('critical', 'integrity', `Corrupt memory files: ${corrupt.join(', ')}`, 'Attempting restore from backup');
            this.restoreFromBackup(corrupt);
            return { name: 'memory-integrity', status: 'critical', value: `${corrupt.length} corrupt`, detail: corrupt.join(', ') };
        }
        if (missing.length > 0) {
            return { name: 'memory-integrity', status: 'degraded', value: `${missing.length} missing`, detail: missing.join(', ') };
        }
        return { name: 'memory-integrity', status: 'ok', value: `${files.length} files OK` };
    }

    private checkProcess(): VitalSign {
        const mem = process.memoryUsage();
        const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0);
        const rssMB = (mem.rss / 1024 / 1024).toFixed(0);
        const uptimeMin = ((Date.now() - this.startTime) / 60_000).toFixed(0);

        let status: VitalSign['status'] = 'ok';
        if (mem.heapUsed > 512 * 1024 * 1024) {
            status = 'degraded';
            this.addThreat('warning', 'process', `High heap usage: ${heapMB}MB`);
        }

        return {
            name: 'process',
            status,
            value: `heap: ${heapMB}MB, rss: ${rssMB}MB, uptime: ${uptimeMin}m`,
        };
    }

    // ── Emergency Actions ──────────────────────────────

    private async emergencyFlushOnce(): Promise<void> {
        if (this.emergencyFlushed) return;
        this.emergencyFlushed = true;
        console.log('🚨 EMERGENCY: Low battery — flushing all memory to disk NOW');
        try {
            await this.config.emergencyFlush();
            this.addThreat('info', 'battery', 'Emergency flush completed successfully');
        } catch (err) {
            this.addThreat('emergency', 'battery', `Emergency flush FAILED: ${err}`);
        }
    }

    // ── Backups ────────────────────────────────────────

    async backupMemory(): Promise<void> {
        const backupDir = resolve(this.config.dataDir, 'backups');
        try {
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const files = ['knowledge-graph.json', 'vectors.json', 'skills.json'];
            let backedUp = 0;

            for (const file of files) {
                const src = resolve(this.config.dataDir, file);
                if (!fs.existsSync(src)) continue;

                // Keep only latest backup per file (overwrite)
                const dest = resolve(backupDir, `${file}.bak`);
                fs.copyFileSync(src, dest);
                backedUp++;
            }

            if (backedUp > 0) {
                this.lastBackup = Date.now();
            }
        } catch (err) {
            this.addThreat('warning', 'backup', `Backup failed: ${err}`);
        }
    }

    private restoreFromBackup(corruptFiles: string[]): void {
        const backupDir = resolve(this.config.dataDir, 'backups');
        for (const file of corruptFiles) {
            const bakPath = resolve(backupDir, `${file}.bak`);
            const destPath = resolve(this.config.dataDir, file);
            if (fs.existsSync(bakPath)) {
                try {
                    const content = fs.readFileSync(bakPath, 'utf-8');
                    JSON.parse(content); // validate backup isn't corrupt too
                    fs.copyFileSync(bakPath, destPath);
                    this.addThreat('info', 'integrity', `Restored ${file} from backup`);
                } catch {
                    this.addThreat('critical', 'integrity', `Backup of ${file} is also corrupt — data may be lost`);
                }
            } else {
                this.addThreat('critical', 'integrity', `No backup found for ${file}`);
            }
        }
    }

    // ── Root-Level Protections (Layer 3) ───────────────

    private async applyProtections(): Promise<void> {
        // Always available (no root needed)
        this.protections.push('signal-traps');
        this.protections.push('memory-backups');
        this.protections.push('integrity-checks');

        // Prevent system sleep while agent is running (no root needed)
        try {
            const caffeinate = require('child_process').spawn('caffeinate', ['-d', '-i', '-s'], {
                detached: true,
                stdio: 'ignore',
            });
            caffeinate.unref();
            this.caffeinatePid = caffeinate.pid;
            this.protections.push('sleep-prevention');
        } catch { }

        // Root-only protections — activate now if we already have access
        if (this.hasRootAccess()) {
            await this.activateRootProtections();
        }
    }

    /**
     * Set/remove immutable (schg) flags on memory files.
     * When set, files can't be deleted/modified even by the owner.
     * We temporarily remove the flag before each write, then re-set it.
     */
    private async setImmutableFlags(set: boolean): Promise<void> {
        if (!this.hasRootAccess()) return;
        const prefix = this.hasRoot ? '' : 'sudo ';
        const flag = set ? 'schg' : 'noschg';
        const files = ['knowledge-graph.json', 'vectors.json', 'skills.json'];
        for (const file of files) {
            const path = resolve(this.config.dataDir, file);
            if (fs.existsSync(path)) {
                try {
                    execSync(`${prefix}chflags ${flag} "${path}"`, { timeout: 5000 });
                } catch { } // non-critical if it fails
            }
        }
    }

    /** Temporarily lift immutable flags for a write operation, then re-set */
    async withWriteAccess<T>(fn: () => Promise<T>): Promise<T> {
        if (this.hasRootAccess()) await this.setImmutableFlags(false);
        try {
            return await fn();
        } finally {
            if (this.hasRootAccess()) await this.setImmutableFlags(true);
        }
    }

    /**
     * Generate a macOS launchd plist that auto-restarts the agent if it dies.
     * Written to ~/.forkscout/ — user can install via:
     *   cp ~/.forkscout/com.forkscout.agent.plist ~/Library/LaunchAgents/
     *   launchctl load ~/Library/LaunchAgents/com.forkscout.agent.plist
     */
    private generateLaunchdPlist(): void {
        const nodePath = process.execPath;
        const servePath = resolve(this.config.dataDir, '..', 'src', 'serve.ts');
        const logPath = resolve(this.config.dataDir, 'agent.log');
        const errLogPath = resolve(this.config.dataDir, 'agent-error.log');
        const workDir = resolve(this.config.dataDir, '..');

        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.forkscout.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>--import</string>
        <string>tsx</string>
        <string>${servePath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workDir}</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${errLogPath}</string>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;

        try {
            const plistPath = resolve(this.config.dataDir, 'com.forkscout.agent.plist');
            fs.writeFileSync(plistPath, plist, 'utf-8');
        } catch { }
    }

    // ── Threat Log ─────────────────────────────────────

    private addThreat(level: ThreatLevel, source: string, message: string, action?: string): void {
        const threat: ThreatEvent = {
            level,
            source,
            message,
            timestamp: Date.now(),
            action,
        };

        // Deduplicate: don't log the same source+message within 60s
        const recent = this.threats.filter(
            t => t.source === source && t.message === message && Date.now() - t.timestamp < 60_000
        );
        if (recent.length > 0) return;

        this.threats.push(threat);
        if (this.threats.length > 100) this.threats = this.threats.slice(-50);

        // Emit for agent/server to react
        this.emit('threat', threat);

        // Console output for critical+
        if (level === 'critical' || level === 'emergency') {
            console.log(`🚨 [SURVIVAL/${source}] ${message}${action ? ` → ${action}` : ''}`);
        } else if (level === 'warning') {
            console.log(`⚠️  [SURVIVAL/${source}] ${message}`);
        }
    }

    /** Get pending threats that should be injected into the next chat response */
    getPendingAlerts(): ThreatEvent[] {
        return this.threats.filter(t =>
            (t.level === 'critical' || t.level === 'emergency') &&
            Date.now() - t.timestamp < 300_000 // last 5 minutes
        );
    }

    /** Format alerts for system prompt injection */
    formatAlerts(): string {
        const alerts = this.getPendingAlerts();
        if (alerts.length === 0) return '';
        return '\n\n[SURVIVAL ALERTS — address immediately]\n' +
            alerts.map(a => `🚨 [${a.source}] ${a.message}${a.action ? ` (auto-action: ${a.action})` : ''}`).join('\n');
    }
}
