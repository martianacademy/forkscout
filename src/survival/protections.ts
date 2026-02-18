/**
 * Root-level protections — immutable flags, sleep prevention, and auto-restart configs.
 *
 * Layer 3 of the survival system. Requires root/sudo access for full
 * protection (immutable flags on macOS, service configs for auto-restart).
 * Base protections (caffeinate) work without root.
 *
 * @module survival/protections
 */

import { exec, execSync, spawn } from 'child_process';
import { resolve } from 'path';
import * as fs from 'fs';

// ── Root Access Probing ────────────────────────────────

/** Check if the current process has root UID. */
export function isRootProcess(): boolean {
    return process.getuid?.() === 0;
}

/**
 * Check if passwordless sudo is available (non-interactive).
 * Unix-only — returns false on Windows.
 */
export function checkSudo(): Promise<boolean> {
    if (process.platform === 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
        exec('sudo -n true 2>/dev/null', { timeout: 3000 }, (err) => {
            resolve(!err);
        });
    });
}

// ── Immutable Flags (macOS chflags) ────────────────────

/**
 * Set or remove immutable (schg) flags on memory files.
 * macOS-only (chflags). When set, files can't be deleted/modified
 * even by the owner. No-op on other platforms.
 */
export function setImmutableFlags(
    set: boolean,
    dataDir: string,
    hasRoot: boolean,
): void {
    if (process.platform !== 'darwin') return;
    const prefix = hasRoot ? '' : 'sudo ';
    const flag = set ? 'schg' : 'noschg';
    const files = ['knowledge-graph.json', 'vectors.json', 'skills.json'];

    for (const file of files) {
        const path = resolve(dataDir, file);
        if (fs.existsSync(path)) {
            try {
                execSync(`${prefix}chflags ${flag} "${path}"`, { timeout: 5000 });
            } catch { } // non-critical if it fails
        }
    }
}

/**
 * Temporarily lift immutable flags for a write operation, then re-set.
 * Pass-through if no root access.
 */
export async function withWriteAccess<T>(
    dataDir: string,
    hasRoot: boolean,
    fn: () => Promise<T>,
): Promise<T> {
    if (hasRoot) setImmutableFlags(false, dataDir, hasRoot);
    try {
        return await fn();
    } finally {
        if (hasRoot) setImmutableFlags(true, dataDir, hasRoot);
    }
}

// ── Sleep Prevention (macOS caffeinate) ────────────────

/**
 * Spawn a caffeinate process to prevent system sleep.
 * macOS-only. Returns the PID or null.
 */
export function startCaffeinate(): number | null {
    if (process.platform !== 'darwin') return null;
    try {
        const proc = spawn('caffeinate', ['-d', '-i', '-s'], {
            detached: true,
            stdio: 'ignore',
        });
        proc.on('error', () => { }); // swallow spawn errors
        proc.unref();
        return proc.pid ?? null;
    } catch {
        return null;
    }
}

/** Kill a caffeinate process by PID. */
export function stopCaffeinate(pid: number | null): void {
    if (pid) {
        try {
            process.kill(pid, 'SIGTERM');
        } catch { }
    }
}

// ── Service Config Generation ──────────────────────────

/**
 * Generate a platform-specific auto-restart service config.
 * - macOS → launchd plist  (saved to dataDir)
 * - Linux → systemd unit   (saved to dataDir)
 * - Windows → skipped
 */
export function generateServiceConfig(dataDir: string): void {
    if (process.platform === 'darwin') {
        generateLaunchdPlist(dataDir);
    } else if (process.platform === 'linux') {
        generateSystemdUnit(dataDir);
    }
}

/** Generate a macOS launchd plist for auto-restart. */
function generateLaunchdPlist(dataDir: string): void {
    const nodePath = process.execPath;
    const servePath = resolve(dataDir, '..', 'src', 'serve.ts');
    const logPath = resolve(dataDir, 'agent.log');
    const errLogPath = resolve(dataDir, 'agent-error.log');
    const workDir = resolve(dataDir, '..');

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
        const plistPath = resolve(dataDir, 'com.forkscout.agent.plist');
        fs.writeFileSync(plistPath, plist, 'utf-8');
    } catch { }
}

/** Generate a Linux systemd unit file for auto-restart. */
function generateSystemdUnit(dataDir: string): void {
    const nodePath = process.execPath;
    const servePath = resolve(dataDir, '..', 'src', 'serve.ts');
    const workDir = resolve(dataDir, '..');

    const unit = `[Unit]
Description=Forkscout Agent
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} --import tsx ${servePath}
WorkingDirectory=${workDir}
Restart=always
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

    try {
        const unitPath = resolve(dataDir, 'forkscout-agent.service');
        fs.writeFileSync(unitPath, unit, 'utf-8');
    } catch { }
}
