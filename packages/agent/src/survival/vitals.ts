/**
 * Vital sign checkers — battery, disk, memory integrity, process health.
 *
 * All functions are standalone: they accept configuration and return
 * structured results. Side effects (threat logging, emergency flush)
 * are signalled through return values, not performed here.
 *
 * @module survival/vitals
 */

import { exec } from 'child_process';
import { resolve } from 'path';
import * as fs from 'fs';
import type { VitalSign, BatteryParseResult, ThreatLevel } from './types';

// ── Battery ────────────────────────────────────────────

/**
 * Check battery level and AC/battery status. Cross-platform:
 * - macOS: pmset -g batt
 * - Linux: /sys/class/power_supply/BAT0
 * - Windows/other: returns N/A gracefully
 */
export function checkBattery(
    batteryWarn: number,
    batteryCritical: number,
): Promise<BatteryParseResult> {
    return new Promise((resolve) => {
        if (process.platform === 'darwin') {
            exec('pmset -g batt', { timeout: 5000 }, (err, stdout) => {
                if (err || !stdout) {
                    resolve({
                        vital: { name: 'battery', status: 'ok', value: 'N/A' },
                        percent: 100,
                        isOnBattery: false,
                        shouldEmergencyFlush: false,
                    });
                    return;
                }
                resolve(parseBatteryOutput(stdout, batteryWarn, batteryCritical));
            });
        } else if (process.platform === 'linux') {
            try {
                const batPath = '/sys/class/power_supply/BAT0';
                if (!fs.existsSync(batPath)) {
                    resolve({
                        vital: { name: 'battery', status: 'ok', value: 'N/A (no battery)' },
                        percent: 100,
                        isOnBattery: false,
                        shouldEmergencyFlush: false,
                    });
                    return;
                }
                const capacity = fs.readFileSync(`${batPath}/capacity`, 'utf-8').trim();
                const statusStr = fs.readFileSync(`${batPath}/status`, 'utf-8').trim();
                const pct = parseInt(capacity) || 100;
                const onAC = statusStr === 'Charging' || statusStr === 'Full' || statusStr === 'Not charging';
                const fakeOutput = `${pct}%; ${onAC ? 'AC Power' : 'discharging'}`;
                resolve(parseBatteryOutput(fakeOutput, batteryWarn, batteryCritical));
            } catch {
                resolve({
                    vital: { name: 'battery', status: 'ok', value: 'N/A' },
                    percent: 100,
                    isOnBattery: false,
                    shouldEmergencyFlush: false,
                });
            }
        } else {
            resolve({
                vital: { name: 'battery', status: 'ok', value: 'N/A (unsupported OS)' },
                percent: 100,
                isOnBattery: false,
                shouldEmergencyFlush: false,
            });
        }
    });
}

/**
 * Parse raw battery output string (pmset or synthetic).
 * Returns percentage, AC status, VitalSign, and any threat info.
 */
export function parseBatteryOutput(
    stdout: string,
    batteryWarn: number,
    batteryCritical: number,
): BatteryParseResult {
    const pctMatch = stdout.match(/(\d+)%/);
    const pct = pctMatch ? parseInt(pctMatch[1]) : 100;
    const onAC = /AC Power/i.test(stdout) || /charged/i.test(stdout);

    let status: VitalSign['status'] = 'ok';
    let detail: string | undefined;
    let threat: BatteryParseResult['threat'];
    let shouldEmergencyFlush = false;

    if (!onAC && pct <= batteryCritical) {
        status = 'critical';
        detail = `CRITICAL: ${pct}% on battery — emergency flush triggered`;
        threat = {
            level: 'emergency' as ThreatLevel,
            source: 'battery',
            message: `Battery at ${pct}% on battery power!`,
            action: 'Emergency memory flush',
        };
        shouldEmergencyFlush = true;
    } else if (!onAC && pct <= batteryWarn) {
        status = 'degraded';
        detail = `Low battery: ${pct}% on battery`;
        threat = {
            level: 'warning' as ThreatLevel,
            source: 'battery',
            message: `Battery at ${pct}% on battery`,
            action: 'Monitoring closely',
        };
    } else if (!onAC) {
        detail = `On battery: ${pct}%`;
    }

    return {
        vital: { name: 'battery', status, value: `${pct}%${onAC ? ' (AC)' : ' (battery)'}`, detail },
        percent: pct,
        isOnBattery: !onAC,
        threat,
        shouldEmergencyFlush,
    };
}

// ── Disk ───────────────────────────────────────────────

/**
 * Check available disk space on the root volume.
 * Returns a VitalSign and optional threat descriptor.
 */
export function checkDisk(diskWarnMB: number): Promise<{
    vital: VitalSign;
    threat?: { level: ThreatLevel; source: string; message: string };
}> {
    return new Promise((resolve) => {
        const cmd =
            process.platform === 'win32'
                ? 'wmic logicaldisk where "DeviceID=C:" get FreeSpace /value'
                : 'df -m / | tail -1';

        exec(cmd, { timeout: 5000 }, (err, stdout) => {
            if (err) {
                resolve({ vital: { name: 'disk', status: 'ok', value: 'unknown' } });
                return;
            }

            let availMB: number;
            if (process.platform === 'win32') {
                const match = stdout.match(/FreeSpace=(\d+)/);
                availMB = match ? Math.floor(parseInt(match[1]) / 1024 / 1024) : 0;
            } else {
                const parts = stdout.trim().split(/\s+/);
                availMB = parseInt(parts[3]) || 0;
            }

            let status: VitalSign['status'] = 'ok';
            let detail: string | undefined;
            let threat: { level: ThreatLevel; source: string; message: string } | undefined;

            if (availMB < 100) {
                status = 'critical';
                detail = `Only ${availMB}MB free — data loss risk`;
                threat = { level: 'critical', source: 'disk', message: `Disk critically low: ${availMB}MB free` };
            } else if (availMB < diskWarnMB) {
                status = 'degraded';
                detail = `Low disk: ${availMB}MB free`;
                threat = { level: 'warning', source: 'disk', message: `Disk space low: ${availMB}MB free` };
            }

            const gb = (availMB / 1024).toFixed(1);
            resolve({ vital: { name: 'disk', status, value: `${gb}GB free`, detail }, threat });
        });
    });
}

// ── Memory Integrity ───────────────────────────────────

/**
 * Check that knowledge-graph, vectors, and skills JSON files
 * exist and contain valid JSON.
 */
export function checkMemoryIntegrity(dataDir: string): {
    vital: VitalSign;
    corruptFiles: string[];
} {
    const files = ['knowledge-graph.json', 'vectors.json', 'skills.json'];
    const missing: string[] = [];
    const corrupt: string[] = [];

    for (const file of files) {
        const path = resolve(dataDir, file);
        if (!fs.existsSync(path)) {
            missing.push(file);
            continue;
        }
        try {
            const content = fs.readFileSync(path, 'utf-8');
            JSON.parse(content);
        } catch {
            corrupt.push(file);
        }
    }

    if (corrupt.length > 0) {
        return {
            vital: {
                name: 'memory-integrity',
                status: 'critical',
                value: `${corrupt.length} corrupt`,
                detail: corrupt.join(', '),
            },
            corruptFiles: corrupt,
        };
    }
    if (missing.length > 0) {
        return {
            vital: {
                name: 'memory-integrity',
                status: 'degraded',
                value: `${missing.length} missing`,
                detail: missing.join(', '),
            },
            corruptFiles: [],
        };
    }
    return {
        vital: { name: 'memory-integrity', status: 'ok', value: `${files.length} files OK` },
        corruptFiles: [],
    };
}

// ── Process Health ─────────────────────────────────────

/**
 * Check Node.js process heap/RSS usage and uptime.
 */
export function checkProcess(startTime: number): {
    vital: VitalSign;
    threat?: { level: ThreatLevel; source: string; message: string };
} {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(0);
    const uptimeMin = ((Date.now() - startTime) / 60_000).toFixed(0);

    let status: VitalSign['status'] = 'ok';
    let threat: { level: ThreatLevel; source: string; message: string } | undefined;

    if (mem.heapUsed > 512 * 1024 * 1024) {
        status = 'degraded';
        threat = { level: 'warning', source: 'process', message: `High heap usage: ${heapMB}MB` };
    }

    return {
        vital: {
            name: 'process',
            status,
            value: `heap: ${heapMB}MB, rss: ${rssMB}MB, uptime: ${uptimeMin}m`,
        },
        threat,
    };
}
