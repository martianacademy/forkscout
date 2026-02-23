/**
 * Sub-Agent Tool — spawns 1-N worker agents that run in parallel.
 *
 * Single tool `spawn_agents` handles both single and batch use cases.
 * Pass an array of 1 for a single agent, or up to maxParallel for parallel batch.
 *
 * Design decisions:
 *   - Max depth = 1 — sub-agents CANNOT spawn further sub-agents (no recursion)
 *   - Model tier configurable per-agent (fast/balanced/powerful) with config default
 *   - Per-agent temperature control (0.0–1.0) with config default
 *   - Step limit, timeout, retry, and output length all configurable via SubAgentConfig
 *   - Sub-agents inherit ALL parent tools minus 3 blocked (spawn_agents, safe_self_edit, self_rebuild)
 *   - Batch-level timeout kills stragglers if the whole batch takes too long
 *   - Live progress feedback via onProgress callback (wired per-request by channel handlers)
 *   - Partial progress recovery on failure via onStepFinish step collection
 *
 * @module tools/agent-tool
 */

import { tool, ToolLoopAgent, stepCountIs } from 'ai';
import { z } from 'zod';
import type { ModelRouter } from '../llm/router';
import { getConfig } from '../config';
import { describeToolCall } from '../utils/describe-tool-call';
import { getSubAgentSystemPrompt } from '../agent/system-prompts';
import type { ToolDeps } from './deps';

/** Auto-discovered by auto-loader — called with ToolDeps at startup. */
export function register(deps: ToolDeps) {
    const subAgentDeps: SubAgentDeps = { router: deps.router, toolSet: deps.toolSet };
    deps.subAgentDeps = subAgentDeps;
    return { spawn_agents: createSubAgentTool(subAgentDeps) };
}

/**
 * Tools that sub-agents must NEVER get — only recursion and self-modification are blocked.
 * Everything else (files, memory, MCP, commands, web) is available by default.
 */
const BLOCKED_TOOLS = new Set([
    'spawn_agents',         // no recursion — sub-agents cannot spawn further sub-agents
    'safe_self_edit',       // no self-modification of agent source code
    'self_rebuild',         // no restart/rebuild of the agent process
]);

/** Fallback constants — prefer getConfig().agent.subAgent at runtime */
const SUBAGENT_MAX_STEPS = 20;
const SUBAGENT_TIMEOUT_MS = 300_000;
const MAX_PARALLEL_AGENTS = 10;

interface SubAgentResult {
    success: boolean;
    output: string;
}

/**
 * Callback for live sub-agent progress. Called on each step with the
 * agent label and a human-readable description of what it just did.
 * Set this on SubAgentDeps before a request, clear it after.
 */
export type SubAgentProgressCallback = (agentLabel: string, message: string) => void;

export interface SubAgentDeps {
    router: ModelRouter;
    /** The full toolSet from the parent agent */
    toolSet: Record<string, any>;
    /** Names of built-in (non-MCP) tools — set by tools-setup after registration */
    builtinToolNames?: Set<string>;
    /**
     * Optional progress callback — set per-request by the channel handler.
     * When set, sub-agents send live step-by-step updates to the user.
     */
    onProgress?: SubAgentProgressCallback;
    /**
     * Parent request's abort signal — set per-request by the channel handler.
     * When the user sends "stop" or a new message, this signal aborts ALL sub-agents
     * spawned during that request, not just the main agent loop.
     */
    parentAbortSignal?: AbortSignal;
}

/**
 * Create the spawn_agents tool. Accepts 1-10 agents that all run in parallel.
 * Use for both single delegation and parallel batch work.
 */
export function createSubAgentTool(deps: SubAgentDeps) {
    return tool({
        description:
            'Spawn 1-10 autonomous sub-agents that run in PARALLEL via Promise.allSettled. ' +
            'Each gets its own LLM loop with configurable model tier, step limit, and timeout. ' +
            'Sub-agents inherit ALL parent tools (files, web, commands, memory read/write, MCP tools) — ' +
            'only spawn_agents, safe_self_edit, and self_rebuild are blocked. ' +
            'Use for: (1) deep research with memory persistence, (2) parallel file analysis, ' +
            '(3) code refactoring with write access, (4) web research with MCP-powered docs lookup. ' +
            'Each agent has an id label for tracking. Pass tools[] to restrict a specific agent\'s toolset if needed.',
        inputSchema: z.object({
            agents: z.array(z.object({
                id: z.string().describe('Short unique label for this agent (e.g. "auth-audit", "test-review")'),
                task: z.string().describe('Detailed task description. Be specific — include file paths, expected output.'),
                context: z.string().optional().describe('Background information this agent needs.'),
                tier: z.enum(['fast', 'balanced', 'powerful']).optional().describe('Override model tier for this agent. Omit to use the default sub-agent tier from config.'),
                temperature: z.number().min(0).max(1).optional().describe('Sampling temperature (0.0–1.0). Lower = deterministic (code review), higher = creative (writing). Omit to use config default.'),
                tools: z.array(z.string()).optional().describe('Override tool list for this agent. Omit to give all available tools.'),
            })).min(1).max(getConfig().agent.subAgent.maxParallel ?? MAX_PARALLEL_AGENTS).describe(
                `Array of 1-${getConfig().agent.subAgent.maxParallel ?? MAX_PARALLEL_AGENTS} sub-agent tasks to run in parallel.`,
            ),
        }),
        execute: async ({ agents }) => {
            const count = agents.length;
            console.log(`[SubAgents]: Spawning ${count} agents in parallel: ${agents.map(a => a.id).join(', ')}`);
            const batchStart = Date.now();

            // Check if parent was already aborted before we even start
            if (deps.parentAbortSignal?.aborted) {
                return '⏹️ Request was cancelled before sub-agents could start.';
            }

            // Batch-level abort controller — kills stragglers if the batch takes too long
            const batchTimeoutMs = getConfig().agent.subAgent.batchTimeoutMs;
            const batchAbort = new AbortController();
            let batchTimer: ReturnType<typeof setTimeout> | undefined;
            if (batchTimeoutMs > 0) {
                batchTimer = setTimeout(() => {
                    console.warn(`[SubAgents]: Batch timeout (${batchTimeoutMs}ms) — aborting remaining agents`);
                    batchAbort.abort();
                }, batchTimeoutMs);
            }

            // If the parent request is aborted (user said "stop"), kill the batch too
            if (deps.parentAbortSignal) {
                deps.parentAbortSignal.addEventListener('abort', () => {
                    console.log('[SubAgents]: Parent request aborted — killing all sub-agents');
                    batchAbort.abort();
                }, { once: true });
            }

            // Run all sub-agents concurrently
            const results = await Promise.allSettled(
                agents.map(agent =>
                    runSubAgent(deps, {
                        task: agent.task,
                        context: agent.context,
                        tier: agent.tier,
                        temperature: agent.temperature,
                        tools: agent.tools,
                        label: agent.id,
                    }, batchAbort.signal),
                ),
            );

            if (batchTimer) clearTimeout(batchTimer);

            const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
            // Count based on the structured result, not Promise status
            const resolved = results.map(r => r.status === 'fulfilled' ? r.value : null);
            const succeeded = resolved.filter(r => r?.success).length;
            const failed = count - succeeded;
            console.log(`[SubAgents]: Batch complete in ${batchElapsed}s — ${succeeded} succeeded, ${failed} failed`);

            // Format combined results
            const sections = agents.map((agent, i) => {
                const result = results[i];
                if (result.status === 'fulfilled') {
                    return `### Agent: ${agent.id}\n${result.value.output}`;
                } else {
                    const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
                    return `### Agent: ${agent.id}\n**FAILED:** ${err.slice(0, 500)}`;
                }
            });

            return [
                `## Parallel Sub-Agent Results (${count} agents, ${batchElapsed}s total)`,
                `*${succeeded} succeeded, ${failed} failed*`,
                '',
                ...sections,
            ].join('\n\n');
        },
    });
}

// ── Shared execution logic ─────────────────────────────

interface SubAgentTask {
    task: string;
    context?: string;
    tier?: 'fast' | 'balanced' | 'powerful';
    temperature?: number;
    tools?: string[];
    label?: string;
}

/**
 * Build the tool subset for a sub-agent.
 *
 * Default: ALL parent tools minus BLOCKED_TOOLS.
 * If `requestedTools` is specified, only those tools (minus blocked) are given.
 */
function buildSubAgentTools(deps: SubAgentDeps, opts: { requestedTools?: string[] }): Record<string, any> {
    const subAgentTools: Record<string, any> = {};

    if (opts.requestedTools && opts.requestedTools.length > 0) {
        // Explicit tool list — give only what's requested (minus blocked)
        for (const name of opts.requestedTools) {
            if (!BLOCKED_TOOLS.has(name) && deps.toolSet[name]) {
                subAgentTools[name] = deps.toolSet[name];
            }
        }
    } else {
        // Default: give ALL parent tools minus blocked
        for (const [name, t] of Object.entries(deps.toolSet)) {
            if (!BLOCKED_TOOLS.has(name)) {
                subAgentTools[name] = t;
            }
        }
    }

    return subAgentTools;
}

/**
 * Extract useful output from sub-agent steps when result.text is empty.
 * Collects any text content from steps + tool result summaries.
 */
function extractFromSteps(steps: any[]): string {
    const parts: string[] = [];

    for (const step of steps) {
        // Grab any intermediate text the model produced
        if (step.text?.trim()) {
            parts.push(step.text.trim());
        }

        // Grab tool results (the actual findings)
        if (step.toolResults?.length) {
            for (const tr of step.toolResults) {
                // AI SDK v6 StepResult content parts use .output (not .result)
                const raw = (tr as any).output;
                const content = typeof raw === 'string'
                    ? raw
                    : JSON.stringify(raw, null, 2);
                if (content && content.length > 10) {
                    parts.push(`**[${tr.toolName}]:**\n${content}`);
                }
            }
        }
    }

    return parts.join('\n\n');
}

/** Run a single sub-agent to completion. Returns structured result for accurate success/failure counting. */
async function runSubAgent(deps: SubAgentDeps, task: SubAgentTask, batchSignal?: AbortSignal): Promise<SubAgentResult> {
    const label = task.label || 'worker';
    console.log(`[SubAgent:${label}]: Starting — ${task.task.slice(0, 120)}${task.task.length > 120 ? '…' : ''}`);
    const startTime = Date.now();

    const subAgentTools = buildSubAgentTools(deps, {
        requestedTools: task.tools,
    });

    const toolNames = Object.keys(subAgentTools);
    console.log(`[SubAgent:${label}]: Tools (${toolNames.length}): ${toolNames.join(', ')}`);

    const systemPrompt = getSubAgentSystemPrompt({
        label,
        toolNames,
        taskContext: task.context,
        builtinToolNames: deps.builtinToolNames,
    });

    // Per-agent tier override → config default → 'fast' fallback
    const subAgentCfg = getConfig().agent.subAgent;
    const requestedTier = task.tier ?? subAgentCfg.tier ?? 'fast';
    const { model, tier, modelId } = deps.router.getModelByTier(requestedTier);
    // Per-agent temperature → config subAgent default → global config temperature → 0.5
    const temp = task.temperature ?? subAgentCfg.temperature ?? getConfig().temperature ?? 0.5;
    console.log(`[SubAgent:${label}]: Using ${tier} tier (${modelId}), temperature=${temp}`);

    // Collect partial steps via callback — if the agent crashes mid-run, we preserve its progress
    const partialSteps: any[] = [];

    // Build the ToolLoopAgent — encapsulates model, tools, system prompt, and stop conditions
    const subAgent = new ToolLoopAgent({
        id: `subagent-${label}`,
        model,
        temperature: temp,
        instructions: systemPrompt,
        tools: subAgentTools,
        maxRetries: subAgentCfg.retryAttempts ?? 2,
        stopWhen: stepCountIs(subAgentCfg.maxSteps ?? SUBAGENT_MAX_STEPS),
        onStepFinish: (step) => {
            partialSteps.push(step);

            // Live progress feedback to the user's channel
            if (deps.onProgress) {
                try {
                    const lines: string[] = [];

                    // Include any reasoning text from this step
                    if (step.text?.trim()) {
                        const preview = step.text.trim().length > 150
                            ? step.text.trim().slice(0, 150) + '…'
                            : step.text.trim();
                        lines.push(preview);
                    }

                    // Describe each tool call
                    if (step.toolCalls?.length) {
                        for (const tc of step.toolCalls as any[]) {
                            lines.push(describeToolCall(tc.toolName, tc.input ?? tc.args ?? {}));
                        }
                    }

                    if (lines.length > 0) {
                        deps.onProgress(label, lines.join('\n'));
                    }
                } catch {
                    // Progress reporting is non-critical — never crash the sub-agent
                }
            }
        },
    });

    try {
        // Use agent.generate() — clean call with just the prompt and abort signal
        const result = await subAgent.generate({
            prompt: task.task,
            abortSignal: AbortSignal.any([
                AbortSignal.timeout(subAgentCfg.timeoutMs ?? SUBAGENT_TIMEOUT_MS),
                ...(batchSignal ? [batchSignal] : []),
            ]),
        });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const steps = result.steps?.length ?? 0;
        const tokens = result.usage
            ? `${result.usage.inputTokens ?? 0}in/${result.usage.outputTokens ?? 0}out`
            : 'unknown';

        console.log(`[SubAgent:${label}]: Completed in ${elapsed}s (${steps} steps, ${tokens} tokens)`);

        if (result.usage) {
            deps.router.recordUsage(tier, result.usage.inputTokens || 0, result.usage.outputTokens || 0);
        }

        // Extract output — prefer final text, fall back to step text/tool results
        let output = result.text?.trim() || '';
        if (!output && result.steps?.length) {
            output = extractFromSteps(result.steps);
        }

        return {
            success: true,
            output: [
                `**${label}** — *${modelId} | ${steps} steps | ${elapsed}s | ${tokens}*`,
                '',
                output || '[Sub-agent completed but produced no usable output]',
            ].join('\n'),
        };
    } catch (error) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const errMsg = error instanceof Error ? error.message : String(error);
        const stepsCompleted = partialSteps.length;
        console.error(`[SubAgent:${label}]: Failed after ${elapsed}s (${stepsCompleted} steps completed): ${errMsg.slice(0, 200)}`);

        // Extract any useful work from steps completed before the crash
        const partialWork = stepsCompleted > 0 ? extractFromSteps(partialSteps) : '';

        const outputParts = [
            `**${label}** — *Failed after ${elapsed}s (${stepsCompleted} steps completed before error)*`,
            '',
            `**Error:** ${errMsg.slice(0, 500)}`,
        ];

        if (partialWork) {
            outputParts.push(
                '',
                `**Partial progress recovered (${stepsCompleted} steps):**`,
                partialWork,
            );
        }

        outputParts.push('', 'Parent agent may need to retry or handle this task directly.');

        return {
            success: false,
            output: outputParts.join('\n'),
        };
    }
}