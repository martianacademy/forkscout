/**
 * Config builders — construct sub-configs from file + env overrides.
 *
 * Pure functions that merge config file values with environment
 * variables and defaults. No side effects, no I/O.
 *
 * @module config/builders
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { PROJECT_ROOT } from '../paths';
import type { ProviderType, RouterConfig, BudgetConfig, AgentSettings } from './types';
import { DEFAULTS } from './types';

// ── Router config builder ──────────────────────────────

export function buildRouterConfig(file: any, globalProvider: ProviderType, _globalBaseURL: string): RouterConfig {
    const fileFast = file?.fast || {};
    const fileBalanced = file?.balanced || {};
    const filePowerful = file?.powerful || {};

    return {
        fast: {
            model: fileFast.model || DEFAULTS.router.fast.model,
            provider: resolveProvider(fileFast.provider || globalProvider),
            baseURL: fileFast.baseURL,
        },
        balanced: {
            model: fileBalanced.model || DEFAULTS.router.balanced.model,
            provider: resolveProvider(fileBalanced.provider || globalProvider),
            baseURL: fileBalanced.baseURL,
        },
        powerful: {
            model: filePowerful.model || DEFAULTS.router.powerful.model,
            provider: resolveProvider(filePowerful.provider || globalProvider),
            baseURL: filePowerful.baseURL,
        },
    };
}

// ── Budget config builder ──────────────────────────────

export function buildBudgetConfig(file: any): BudgetConfig {
    return {
        dailyUSD: file?.dailyUSD ?? DEFAULTS.budget.dailyUSD,
        monthlyUSD: file?.monthlyUSD ?? DEFAULTS.budget.monthlyUSD,
        warningPct: file?.warningPct ?? DEFAULTS.budget.warningPct,
    };
}

// ── Agent settings builder ─────────────────────────────

export function buildAgentConfig(file: any): AgentSettings {
    // Merge MCP servers: file entries override defaults by name
    const defaultMcp = DEFAULTS.agent.mcpServers;
    const fileMcp = file?.mcpServers || {};
    const mcpServers = { ...defaultMcp, ...fileMcp };

    return {
        maxIterations: file?.maxIterations ?? DEFAULTS.agent.maxIterations,
        autoRegisterTools: file?.autoRegisterTools ?? DEFAULTS.agent.autoRegisterTools,
        port: intEnv('AGENT_PORT') ?? file?.port ?? DEFAULTS.agent.port,
        owner: env('AGENT_OWNER') || file?.owner || DEFAULTS.agent.owner,
        mcpServers,
    };
}

// ── Provider resolution ────────────────────────────────

/**
 * Normalize a provider string to a known ProviderType.
 * Falls back to 'openrouter' for unknown values.
 */
export function resolveProvider(raw: string): ProviderType {
    const lc = (raw || '').toLowerCase().trim();
    switch (lc) {
        case 'openrouter': return 'openrouter';
        case 'openai': return 'openai';
        case 'anthropic': return 'anthropic';
        case 'google': case 'google-ai': case 'gemini': return 'google';
        case 'ollama': return 'ollama';
        case 'openai-compatible': case 'custom': return 'openai-compatible';
        default: return 'openrouter';
    }
}

/**
 * Resolve the provider URL from env for the default provider.
 * Used during config loading before the config is fully built.
 */
export function resolveProviderUrl(provider: ProviderType): string | undefined {
    const envUrlMap: Record<string, string> = {
        openrouter: 'OPENROUTER_API_URL',
        openai: 'OPENAI_API_URL',
        anthropic: 'ANTHROPIC_API_URL',
        google: 'GOOGLE_API_URL',
        'openai-compatible': 'OPEN_API_COMPATIBLE_API_URL',
    };
    const envKey = envUrlMap[provider];
    return envKey ? env(envKey) : undefined;
}

// ── Utilities ──────────────────────────────────────────

/** Read an env var; returns undefined for empty/unset values. */
export function env(key: string): string | undefined {
    const val = process.env[key];
    return val && val.trim() !== '' ? val.trim() : undefined;
}

/** Read an env var as an integer; returns undefined if not set or NaN. */
export function intEnv(key: string): number | undefined {
    const v = env(key);
    if (v === undefined) return undefined;
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n;
}

/**
 * Search for forkscout.config.json from cwd upward, then project root.
 * Returns the resolved path or null if not found.
 */
export function findConfigFile(): string | null {
    const candidates = [
        resolve(process.cwd(), 'forkscout.config.json'),
        resolve(PROJECT_ROOT, 'forkscout.config.json'),
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}
