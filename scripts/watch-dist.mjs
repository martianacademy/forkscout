#!/usr/bin/env node
/**
 * Watch dist/ and auto-restart the agent server when a new build lands.
 * Usage:  node scripts/watch-dist.mjs          (runs dist/serve.js via tsx)
 *         node scripts/watch-dist.mjs cli       (runs dist/cli.js via tsx)
 *
 * Zero dependencies — uses Node's built-in fs.watch + child_process.
 */

import { spawn, execSync } from 'node:child_process';
import { watch, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

const mode = process.argv[2] || 'serve';
const entry = mode === 'cli' ? 'dist/cli.js' : 'dist/serve.js';

// Read port from config (default 3210)
let PORT = 3210;
try {
    const cfg = JSON.parse(readFileSync(resolve(ROOT, 'forkscout.config.json'), 'utf-8'));
    PORT = cfg?.agent?.port || 3210;
} catch {
    /* use default */
}

const DEBOUNCE_MS = 800; // wait for tsc to finish writing all files
const RESTART_COOLDOWN_MS = 2000; // min time between restarts
const PORT_WAIT_MS = 100; // poll interval for port check
const PORT_TIMEOUT_MS = 10000; // max time to wait for port to free

let child = null;
let restartTimer = null;
let lastRestart = 0;
let stoppingForRestart = false; // true while we're intentionally killing child for a restart
let startInProgress = false; // mutex to prevent concurrent startChild() calls

function log(msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(`\x1b[36m[watch-dist ${ts}]\x1b[0m ${msg}`);
}

/** Check if a port is in use by attempting to connect */
function isPortInUse(port) {
    return new Promise((resolve) => {
        const conn = createConnection({ port, host: '0.0.0.0' });
        conn.once('connect', () => {
            conn.destroy();
            resolve(true);
        });
        conn.once('error', () => resolve(false));
        setTimeout(() => {
            conn.destroy();
            resolve(false);
        }, 500);
    });
}

/** Kill any process occupying the port */
function killPortOccupier(port) {
    try {
        const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (pids) {
            log(`Killing process(es) on port ${port}: ${pids.split('\n').join(', ')}`);
            execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`);
        }
    } catch {
        /* no process on port — fine */
    }
}

/** Wait until the port is free, force-killing occupiers if needed */
async function waitForPortFree(port) {
    const start = Date.now();
    // First check — if port is free, return immediately
    if (!(await isPortInUse(port))) return;

    log(`Waiting for port ${port} to be released…`);

    // Wait a bit for graceful shutdown
    for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, PORT_WAIT_MS * 5));
        if (!(await isPortInUse(port))) return;
    }

    // Still in use — force kill
    killPortOccupier(port);

    // Wait for OS to release
    while (Date.now() - start < PORT_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, PORT_WAIT_MS));
        if (!(await isPortInUse(port))) {
            log(`Port ${port} is free`);
            return;
        }
    }
    log(`⚠️  Port ${port} still in use after ${PORT_TIMEOUT_MS / 1000}s — starting anyway`);
}

async function startChild() {
    // Prevent concurrent starts
    if (startInProgress) {
        log('Start already in progress — skipping');
        return;
    }
    startInProgress = true;

    try {
        await waitForPortFree(PORT);
        log(`Starting: tsx ${entry}`);
        lastRestart = Date.now();

        child = spawn('npx', ['tsx', entry], {
            cwd: ROOT,
            stdio: 'inherit',
            env: { ...process.env },
            detached: true, // create process group so we can kill the entire tree
        });

        child.on('exit', (code, signal) => {
            child = null;

            // If we killed this child intentionally for a restart, don't auto-respawn.
            // The restart() function will call startChild() after stopChild() resolves.
            if (stoppingForRestart) return;

            // SIGTERM/SIGINT from outside (e.g. Ctrl+C) — don't respawn
            if (signal === 'SIGTERM' || signal === 'SIGINT') return;

            log(`Process exited (code=${code}, signal=${signal}) — restarting in 3s`);
            setTimeout(() => startChild(), 3000);
        });
    } finally {
        startInProgress = false;
    }
}

function stopChild() {
    return new Promise((resolve) => {
        if (!child) return resolve();
        stoppingForRestart = true;
        child.once('exit', () => {
            stoppingForRestart = false;
            resolve();
        });
        // Kill entire process group (npx → tsx → node) not just the direct child
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        // Force kill after 5s
        setTimeout(() => {
            if (child) {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already dead */ } }
            }
            // Resolve even if SIGKILL — don't hang forever
            setTimeout(() => {
                stoppingForRestart = false;
                resolve();
            }, 500);
        }, 5000);
    });
}

async function restart() {
    const elapsed = Date.now() - lastRestart;
    if (elapsed < RESTART_COOLDOWN_MS) {
        log(`Cooldown active (${Math.round(RESTART_COOLDOWN_MS - elapsed)}ms left) — skipping`);
        return;
    }
    log('Build change detected — restarting…');
    await stopChild();
    await startChild();
}

function scheduleRestart() {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        restart();
    }, DEBOUNCE_MS);
}

// Watch dist/ recursively for changes
try {
    watch(DIST, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        // Only care about .js and .js.map files
        if (filename.endsWith('.js') || filename.endsWith('.js.map')) {
            scheduleRestart();
        }
    });
    log(`Watching ${DIST} for changes`);
} catch (err) {
    console.error(`Failed to watch ${DIST}:`, err.message);
    console.error('Make sure to run "pnpm build" first.');
    process.exit(1);
}

// Forward signals for clean shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
        log(`Received ${sig} — shutting down`);
        if (restartTimer) clearTimeout(restartTimer);
        await stopChild();
        process.exit(0);
    });
}

// Start immediately
startChild();
