/**
 * Canonical path constants for the Forkscout agent.
 *
 * All paths are absolute, derived from __dirname so they're
 * correct regardless of process.cwd().
 */

import { resolve } from 'path';

/** Absolute path to the monorepo root (contains pnpm-workspace.yaml, .git) */
export const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

/** Absolute path to the agent package root */
export const AGENT_ROOT = resolve(__dirname, '..');

/** Absolute path to the agent source directory */
export const AGENT_SRC = resolve(__dirname);

/**
 * Resolve a path the agent provides.
 *
 * - Absolute paths are returned as-is.
 * - Relative paths are resolved against PROJECT_ROOT
 *   (so "packages/agent/src/foo.ts" works regardless of CWD).
 */
export function resolveAgentPath(p: string): string {
    if (!p || p.trim() === '') return PROJECT_ROOT;
    if (resolve(p) === p) return p; // already absolute
    return resolve(PROJECT_ROOT, p);
}
