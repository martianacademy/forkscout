#!/usr/bin/env node
/**
 * Watch dist/ and auto-restart the agent server when a new build lands.
 * Usage:  node scripts/watch-dist.mjs          (runs dist/serve.js via tsx)
 *         node scripts/watch-dist.mjs cli       (runs dist/cli.js via tsx)
 *
 * Zero dependencies — uses Node's built-in fs.watch + child_process.
 */

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');

const mode = process.argv[2] || 'serve';
const entry = mode === 'cli' ? 'dist/cli.js' : 'dist/serve.js';

const DEBOUNCE_MS = 800; // wait for tsc to finish writing all files
const RESTART_COOLDOWN_MS = 2000; // min time between restarts

let child = null;
let restartTimer = null;
let lastRestart = 0;

function log(msg) {
    const ts = new Date().toLocaleTimeString();
    console.log(`\x1b[36m[watch-dist ${ts}]\x1b[0m ${msg}`);
}

function startChild() {
    log(`Starting: tsx ${entry}`);
    lastRestart = Date.now();

    child = spawn('npx', ['tsx', entry], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env },
    });

    child.on('exit', (code, signal) => {
        child = null;
        if (signal === 'SIGTERM' || signal === 'SIGINT') {
            // Normal shutdown from our restart — we'll respawn via the watcher
            return;
        }
        log(`Process exited (code=${code}, signal=${signal}) — restarting in 2s`);
        setTimeout(startChild, 2000);
    });
}

function stopChild() {
    return new Promise((resolve) => {
        if (!child) return resolve();
        child.once('exit', resolve);
        child.kill('SIGTERM');
        // Force kill after 5s
        setTimeout(() => {
            if (child) {
                child.kill('SIGKILL');
                resolve();
            }
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
    startChild();
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
