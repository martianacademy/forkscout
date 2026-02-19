/**
 * Sub-Agent Tool — spawns 1-10 worker agents that run in parallel.
 *
 * Single tool `spawn_agents` handles both single and batch use cases.
 * Pass an array of 1 for a single agent, or up to 10 for parallel batch.
 *
 * Design decisions:
 *   - Max depth = 1 — sub-agents CANNOT spawn further sub-agents (no recursion)
 *   - Uses the "fast" model tier for quick parallel results
 *   - Step limit capped at 10 (vs. 20 for the parent agent)
 *   - Sub-agents get read/web tools by default, not destructive ones
 *   - Timeout safety: AbortSignal after 300 seconds per sub-agent
 *   - Parallel batch capped at 10 concurrent sub-agents
 *
 * @module tools/agent-tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import { stepCountIs } from 'ai';
import { generateTextWithRetry } from '../llm/retry';
import type { ModelRouter } from '../llm/router';

/** Tool names that sub-agents are allowed to use by default */
const DEFAULT_SUBAGENT_TOOLS = new Set([
    'read_file',
    'list_directory',
    'web_search',
    'browse_web',
    'get_current_date',
    'think',
    'run_command',
]);

/** Tool names that sub-agents must NEVER get (prevents recursion + danger) */
const BLOCKED_TOOLS = new Set([
    'spawn_agents',         // no recursion
    'safe_self_edit',       // no self-modification
    'self_rebuild',         // no restart
    'write_file',           // read-only by default
    'append_file',          // read-only by default
    'delete_file',          // read-only by default
]);

const SUBAGENT_MAX_STEPS = 10;
const SUBAGENT_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_PARALLEL_AGENTS = 10;      // max concurrent sub-agents in a batch

interface SubAgentResult {
    success: boolean;
    output: string;
}

interface SubAgentDeps {
    router: ModelRouter;
    /** The full toolSet from the parent agent */
    toolSet: Record<string, any>;
}

/**
 * Create the spawn_agents tool. Accepts 1-10 agents that all run in parallel.
 * Use for both single delegation and parallel batch work.
 */
export function createSubAgentTool(deps: SubAgentDeps) {
    return tool({
        description:
            'Spawn 1-10 sub-agents that run in PARALLEL. All agents start simultaneously via Promise.all. ' +
            'Each gets its own LLM loop, fast model, 10-step limit, 5-minute timeout. ' +
            'Use for: (1) single research/analysis tasks, (2) parallel independent work (dramatically faster than sequential). ' +
            'Pass 1 agent for simple delegation, or up to 10 for batch. Each agent has an id label for tracking. ' +
            'Sub-agents can read files, search the web, run commands, and access memory — but cannot write files by default or spawn further agents.',
        inputSchema: z.object({
            agents: z.array(z.object({
                id: z.string().describe('Short unique label for this agent (e.g. "auth-audit", "test-review")'),
                task: z.string().describe('Detailed task description. Be specific — include file paths, expected output.'),
                context: z.string().optional().describe('Background information this agent needs.'),
                allowWrite: z.boolean().optional().describe('Allow file writes (default: false).'),
                tools: z.array(z.string()).optional().describe('Override tool list for this agent.'),
            })).min(1).max(MAX_PARALLEL_AGENTS).describe(
                `Array of 1-${MAX_PARALLEL_AGENTS} sub-agent tasks to run in parallel.`,
            ),
        }),
        execute: async ({ agents }) => {
            const count = agents.length;
            console.log(`[SubAgents]: Spawning ${count} agents in parallel: ${agents.map(a => a.id).join(', ')}`);
            const batchStart = Date.now();

            // Run all sub-agents concurrently
            const results = await Promise.allSettled(
                agents.map(agent =>
                    runSubAgent(deps, {
                        task: agent.task,
                        context: agent.context,
                        allowWrite: agent.allowWrite,
                        tools: agent.tools,
                        label: agent.id,
                    }),
                ),
            );

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
    allowWrite?: boolean;
    tools?: string[];
    label?: string;
}

/** Build the tool subset for a sub-agent */
function buildSubAgentTools(deps: SubAgentDeps, opts: { allowWrite?: boolean; requestedTools?: string[] }): Record<string, any> {
    const subAgentTools: Record<string, any> = {};

    if (opts.requestedTools && opts.requestedTools.length > 0) {
        for (const name of opts.requestedTools) {
            if (!BLOCKED_TOOLS.has(name) && deps.toolSet[name]) {
                subAgentTools[name] = deps.toolSet[name];
            }
        }
    } else {
        for (const name of DEFAULT_SUBAGENT_TOOLS) {
            if (deps.toolSet[name]) {
                subAgentTools[name] = deps.toolSet[name];
            }
        }
        if (opts.allowWrite) {
            for (const name of ['write_file', 'append_file']) {
                if (deps.toolSet[name]) {
                    subAgentTools[name] = deps.toolSet[name];
                }
            }
        }
    }

    // Always include think tool
    if (deps.toolSet.think && !subAgentTools.think) {
        subAgentTools.think = deps.toolSet.think;
    }

    // Include forkscout-memory read tools
    for (const [name, t] of Object.entries(deps.toolSet)) {
        if (name.startsWith('forkscout-mem_search') || name.startsWith('forkscout-mem_get')) {
            subAgentTools[name] = t;
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
                const content = typeof tr.result === 'string'
                    ? tr.result
                    : JSON.stringify(tr.result, null, 2);
                if (content && content.length > 10) {
                    // Truncate very large tool outputs
                    const truncated = content.length > 2000
                        ? content.slice(0, 2000) + '\n... (truncated)'
                        : content;
                    parts.push(`**[${tr.toolName}]:**\n${truncated}`);
                }
            }
        }
    }

    return parts.join('\n\n');
}

/** Run a single sub-agent to completion. Returns structured result for accurate success/failure counting. */
async function runSubAgent(deps: SubAgentDeps, task: SubAgentTask): Promise<SubAgentResult> {
    const label = task.label || 'worker';
    console.log(`[SubAgent:${label}]: Starting — ${task.task.slice(0, 120)}${task.task.length > 120 ? '…' : ''}`);
    const startTime = Date.now();

    const subAgentTools = buildSubAgentTools(deps, {
        allowWrite: task.allowWrite,
        requestedTools: task.tools,
    });

    const toolNames = Object.keys(subAgentTools);
    console.log(`[SubAgent:${label}]: Tools (${toolNames.length}): ${toolNames.join(', ')}`);

    const systemPrompt = [
        'You are a focused worker agent handling a specific subtask.',
        'Complete the task thoroughly, then provide a clear final answer.',
        'You have access to tools — use them as needed.',
        'Be efficient: minimize unnecessary steps.',
        'Do NOT attempt to spawn further sub-agents.',
        'IMPORTANT: After using tools, you MUST write a text summary of your findings. Do NOT end with just tool calls.',
        task.context ? `\nContext from parent agent:\n${task.context}` : '',
    ].filter(Boolean).join('\n');

    // Use fast tier for quick parallel results
    const { model, tier, modelId } = deps.router.getModelByTier('fast');
    console.log(`[SubAgent:${label}]: Using ${tier} tier (${modelId})`);

    try {
        const result = await generateTextWithRetry(
            {
                model,
                system: systemPrompt,
                prompt: task.task,
                tools: subAgentTools,
                stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
                abortSignal: AbortSignal.timeout(SUBAGENT_TIMEOUT_MS),
            },
            { maxAttempts: 2, initialDelayMs: 500 },
        );

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
        console.error(`[SubAgent:${label}]: Failed after ${elapsed}s: ${errMsg.slice(0, 200)}`);

        return {
            success: false,
            output: [
                `**${label}** — *Failed after ${elapsed}s*`,
                '',
                `Error: ${errMsg.slice(0, 500)}`,
                '',
                'Parent agent may need to handle this task directly.',
            ].join('\n'),
        };
    }
}