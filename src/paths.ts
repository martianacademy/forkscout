/**
 * Canonical path constants for the Forkscout agent.
 *
 * All paths are absolute, derived from __dirname so they're
 * correct regardless of process.cwd(). Auto-detects whether
 * running from src/ (via tsx) or dist/ (compiled build).
 *
 * @module paths
 */

import { resolve } from 'path';

/**
 * True when running from dist/ (compiled build).
 * When __dirname ends in /dist or /dist/..., we know we're in the build output.
 */
const IS_DIST = __dirname.includes('/dist');

/** Absolute path to the project root (same as agent root after monorepo flattening) */
export const AGENT_ROOT = IS_DIST
    ? resolve(__dirname, '..')   // dist/  → project root
    : resolve(__dirname, '..');  // src/   → project root

/** Absolute path to the project root (same as AGENT_ROOT — kept for compatibility) */
export const PROJECT_ROOT = AGENT_ROOT;

/** Absolute path to the agent source directory (always src/, even when running from dist/) */
export const AGENT_SRC = resolve(AGENT_ROOT, 'src');

/** Absolute path to the agent dist directory */
export const AGENT_DIST = resolve(AGENT_ROOT, 'dist');

/**
 * Resolve a path the agent provides, jailed to PROJECT_ROOT.
 *
 * - Relative paths are resolved against PROJECT_ROOT.
 * - Absolute paths are validated to be within PROJECT_ROOT.
 * - Throws if the resolved path escapes the project root (path traversal).
 *
 * @throws Error if the resolved path is outside PROJECT_ROOT
 */
export function resolveAgentPath(p: string): string {
    if (!p || p.trim() === '') return PROJECT_ROOT;
    const resolved = resolve(p) === p ? p : resolve(PROJECT_ROOT, p);
    // Jail: resolved path must be within PROJECT_ROOT (or /tmp for scratch work)
    if (!resolved.startsWith(PROJECT_ROOT) && !resolved.startsWith('/tmp')) {
        throw new Error(`Path traversal blocked: "${p}" resolves outside project root`);
    }
    return resolved;
}
