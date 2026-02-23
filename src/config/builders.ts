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
import type { ProviderType, RouterConfig, AgentSettings, ProviderRouterPresets } from './types';
import { DEFAULTS, PROVIDER_ROUTER_DEFAULTS } from './types';

// ── Router config builder ──────────────────────────────

/**
 * Detect whether `file` is per-provider format (keys are provider names)
 * or flat format (keys are tier names: fast/balanced/powerful).
 */
function isPerProviderFormat(file: any): boolean {
    if (!file || typeof file !== 'object') return false;
    const providerKeys = ['openrouter', 'openai', 'anthropic', 'google', 'ollama', 'openai-compatible'];
    return Object.keys(file).some(k => providerKeys.includes(k));
}

/**
 * Build RouterConfig from config file.
 *
 * Supports two formats:
 *   1. Flat: { fast: {...}, balanced: {...}, powerful: {...} }
 *   2. Per-provider: { openrouter: { fast, balanced, powerful }, google: { ... }, ... }
 *      → resolves the active provider's preset
 *
 * Returns { router, routerPresets? } — routerPresets is set only for per-provider format.
 */
export function buildRouterConfig(
    file: any,
    globalProvider: ProviderType,
    _globalBaseURL: string,
): { router: RouterConfig; routerPresets?: ProviderRouterPresets } {
    // Per-provider format
    if (isPerProviderFormat(file)) {
        const presets: ProviderRouterPresets = {};

        for (const [providerName, tierBlock] of Object.entries(file)) {
            const provider = resolveProvider(providerName);
            const t = tierBlock as any;
            presets[provider] = {
                fast: {
                    model: t?.fast?.model || PROVIDER_ROUTER_DEFAULTS[provider]?.fast?.model || DEFAULTS.router.fast.model,
                    provider: resolveProvider(t?.fast?.provider || provider),
                    baseURL: t?.fast?.baseURL,
                },
                balanced: {
                    model: t?.balanced?.model || PROVIDER_ROUTER_DEFAULTS[provider]?.balanced?.model || DEFAULTS.router.balanced.model,
                    provider: resolveProvider(t?.balanced?.provider || provider),
                    baseURL: t?.balanced?.baseURL,
                },
                powerful: {
                    model: t?.powerful?.model || PROVIDER_ROUTER_DEFAULTS[provider]?.powerful?.model || DEFAULTS.router.powerful.model,
                    provider: resolveProvider(t?.powerful?.provider || provider),
                    baseURL: t?.powerful?.baseURL,
                },
            };
        }

        // Resolve active provider's preset (fall back to defaults)
        const active = presets[globalProvider]
            || PROVIDER_ROUTER_DEFAULTS[globalProvider]
            || DEFAULTS.router;

        return { router: active, routerPresets: presets };
    }

    // Legacy flat format
    const fileFast = file?.fast || {};
    const fileBalanced = file?.balanced || {};
    const filePowerful = file?.powerful || {};

    return {
        router: {
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
        },
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
        maxSteps: file?.maxSteps ?? DEFAULTS.agent.maxSteps,
        autoRegisterTools: file?.autoRegisterTools ?? DEFAULTS.agent.autoRegisterTools,
        port: intEnv('AGENT_PORT') ?? file?.port ?? DEFAULTS.agent.port,
        owner: env('AGENT_OWNER') || file?.owner || DEFAULTS.agent.owner,
        appName: file?.appName || DEFAULTS.agent.appName,
        appUrl: file?.appUrl || DEFAULTS.agent.appUrl,
        forkscoutMemoryMcpUrl: env('MEMORY_MCP_URL') || file?.forkscoutMemoryMcpUrl || DEFAULTS.agent.forkscoutMemoryMcpUrl,
        mcpServers,
        subAgent: {
            maxSteps: file?.subAgent?.maxSteps ?? DEFAULTS.agent.subAgent.maxSteps,
            timeoutMs: file?.subAgent?.timeoutMs ?? DEFAULTS.agent.subAgent.timeoutMs,
            maxParallel: file?.subAgent?.maxParallel ?? DEFAULTS.agent.subAgent.maxParallel,
            tier: file?.subAgent?.tier ?? DEFAULTS.agent.subAgent.tier,
            retryAttempts: file?.subAgent?.retryAttempts ?? DEFAULTS.agent.subAgent.retryAttempts,
            retryDelayMs: file?.subAgent?.retryDelayMs ?? DEFAULTS.agent.subAgent.retryDelayMs,
            outputMaxLength: file?.subAgent?.outputMaxLength ?? DEFAULTS.agent.subAgent.outputMaxLength,
            temperature: file?.subAgent?.temperature ?? DEFAULTS.agent.subAgent.temperature,
            batchTimeoutMs: file?.subAgent?.batchTimeoutMs ?? DEFAULTS.agent.subAgent.batchTimeoutMs,
        },
        server: {
            rateLimitLocal: file?.server?.rateLimitLocal ?? DEFAULTS.agent.server.rateLimitLocal,
            rateLimitRemote: file?.server?.rateLimitRemote ?? DEFAULTS.agent.server.rateLimitRemote,
            rateLimitWindowMs: file?.server?.rateLimitWindowMs ?? DEFAULTS.agent.server.rateLimitWindowMs,
            maxBodyBytes: file?.server?.maxBodyBytes ?? DEFAULTS.agent.server.maxBodyBytes,
        },
        telegram: {
            maxInbox: file?.telegram?.maxInbox ?? DEFAULTS.agent.telegram.maxInbox,
            maxHistory: file?.telegram?.maxHistory ?? DEFAULTS.agent.telegram.maxHistory,
        },
        failureEscalationThreshold: file?.failureEscalationThreshold ?? DEFAULTS.agent.failureEscalationThreshold,
        browserIdleMs: file?.browserIdleMs ?? DEFAULTS.agent.browserIdleMs,
        activityLogMaxBytes: file?.activityLogMaxBytes ?? DEFAULTS.agent.activityLogMaxBytes,
        maxToolRetries: file?.maxToolRetries ?? DEFAULTS.agent.maxToolRetries,
        contextPruneAfterStep: file?.contextPruneAfterStep ?? DEFAULTS.agent.contextPruneAfterStep,
        contextKeepLastMessages: file?.contextKeepLastMessages ?? DEFAULTS.agent.contextKeepLastMessages,
        effortStepsQuick: file?.effortStepsQuick ?? DEFAULTS.agent.effortStepsQuick,
        effortStepsModerate: file?.effortStepsModerate ?? DEFAULTS.agent.effortStepsModerate,
        agentMaxRetries: file?.agentMaxRetries ?? DEFAULTS.agent.agentMaxRetries,
        compressThreshold: file?.compressThreshold ?? DEFAULTS.agent.compressThreshold,
        compressMaxSummary: file?.compressMaxSummary ?? DEFAULTS.agent.compressMaxSummary,
        compressAfterStep: file?.compressAfterStep ?? DEFAULTS.agent.compressAfterStep,
        compressInputMaxChars: file?.compressInputMaxChars ?? DEFAULTS.agent.compressInputMaxChars,
        flightMaxRetries: file?.flightMaxRetries ?? DEFAULTS.agent.flightMaxRetries,
        plannerChatHistoryLimit: file?.plannerChatHistoryLimit ?? DEFAULTS.agent.plannerChatHistoryLimit,
        postflightMaxResponseChars: file?.postflightMaxResponseChars ?? DEFAULTS.agent.postflightMaxResponseChars,
        dynamicToolLoading: file?.dynamicToolLoading ?? DEFAULTS.agent.dynamicToolLoading,
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
        case 'github': case 'github-models': return 'github';
        case 'copilot-bridge': case 'copilot': case 'vscode': return 'copilot-bridge';
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
        github: 'GITHUB_API_URL',
        'copilot-bridge': 'COPILOT_BRIDGE_URL',
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
