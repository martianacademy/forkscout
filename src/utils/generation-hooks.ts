/**
 * Generation Lifecycle Hooks — reusable callbacks for the ToolLoopAgent.
 *
 * Every channel (CLI, HTTP stream, HTTP sync, Telegram) needs the same
 * post-generation work: resolve response, record cost, log activity,
 * learn from failures, save to memory. This module centralises that.
 *
 * @module utils/generation-hooks
 */

import { getReasoningSummary, type TurnTracker } from '../llm/reasoning';
import { runPostflight } from '../llm/postflight';
import { resolveAgentResponse } from './resolve-response';
import { buildFailureObservation } from '../memory';
import { logToolCall, logLLMCall } from '../activity-log';
import type { Agent, ChatContext } from '../agent';
import type { ChatChannel } from '../agent/types';

// ── Tool Name → Human Label ────────────────────────────

const TOOL_LABELS: Record<string, string> = {
    web_search: 'Searching the web',
    browse_web: 'Reading webpage',
    read_file: 'Reading file',
    write_file: 'Writing file',
    run_command: 'Running command',
    spawn_agents: 'Spawning sub-agents',
    http_request: 'Making HTTP request',
    search_knowledge: 'Searching memory',
    search_entities: 'Searching knowledge graph',
};

function toolLabel(name: string): string {
    return TOOL_LABELS[name] || name.replace(/_/g, ' ');
}

// ── Step Logging ───────────────────────────────────────

export interface StepLoggerOptions {
    /** Write tool calls to the activity log (default: true) */
    activityLog?: boolean;
    /** UIMessageStream writer — if provided, emits progress markers to the stream */
    writer?: {
        write: (part: any) => void;
    };
}

/**
 * Create an `onStepFinish` callback that logs tool calls to console + activity log.
 * When a stream `writer` is provided, also emits progress text markers so the user
 * sees live updates like "[Searching the web...]" between steps.
 *
 * Use for HTTP stream/sync endpoints. Telegram has its own step handler
 * (sends messages to the chat), but can still use this for logging.
 */
export function createStepLogger(opts?: StepLoggerOptions) {
    const logActivity = opts?.activityLog !== false;
    const writer = opts?.writer;
    let stepIndex = 0;

    return ({ toolCalls, toolResults }: any) => {
        stepIndex++;

        if (toolCalls && toolCalls.length > 0) {
            console.log(`[Agent]: Step — ${toolCalls.length} tool call(s): ${toolCalls.map((tc: any) => tc.toolName).join(', ')}`);

            // Emit streaming progress marker
            if (writer) {
                const labels = (toolCalls as any[]).map((tc: any) => toolLabel(tc.toolName));
                const progressText = `\n[${labels.join(', ')}...]\n`;
                const progressId = `progress-${Date.now()}-${stepIndex}`;
                try {
                    writer.write({ type: 'text-start', id: progressId });
                    writer.write({ type: 'text-delta', delta: progressText, id: progressId });
                    writer.write({ type: 'text-end', id: progressId });
                } catch { /* stream may be closed */ }
            }
        }
        if (toolResults && toolResults.length > 0) {
            for (const tr of toolResults) {
                const output = typeof (tr as any).output === 'string'
                    ? (tr as any).output.slice(0, 100)
                    : JSON.stringify((tr as any).output).slice(0, 100);
                console.log(`  ↳ ${(tr as any).toolName}: ${output}`);
            }
        }
        // Activity log: record each tool call
        if (logActivity && toolCalls && toolCalls.length > 0) {
            for (let i = 0; i < toolCalls.length; i++) {
                const tc = toolCalls[i] as any;
                const tr = toolResults?.[i] as any;
                const resultStr = tr?.output
                    ? (typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output))
                    : undefined;
                logToolCall(tc.toolName, tc.input, resultStr);
            }
        }
    };
}

// ── Post-Generation Finalization ───────────────────────

export interface FinalizeOptions {
    /** The raw text from generate() */
    text: string | undefined;
    /** The steps from generate() */
    steps: any[] | undefined;
    /** Token usage from generate() */
    usage: { inputTokens?: number; outputTokens?: number } | undefined;
    /** The turn tracker for this request */
    reasoningCtx: TurnTracker;
    /** The model ID string (for activity logging) */
    modelId: string;
    /** The channel this request came from */
    channel: ChatChannel;
    /** The agent instance (for router, memory) */
    agent: Agent;
    /** Chat context for memory save */
    ctx?: ChatContext;
    /** The user's original message (for postflight quality gate) */
    userMessage?: string;
    /** Structured output from ToolLoopAgent.generate() — Output.object({ answer }) */
    output?: { answer?: string } | null;
}

export interface FinalizeResult {
    /** The resolved response text (from model text, step text, or tool results) */
    response: string;
    /** Estimated cost in USD */
    cost: number;
    /** Number of steps completed */
    stepCount: number;
    /** Whether the model was escalated mid-task */
    escalated: boolean;
    /** Number of tool failures */
    toolFailures: number;
    /** Postflight verdict (null if skipped) */
    postflight: { shouldRetry: boolean; reason: string } | null;
}

/**
 * Run the full post-generation pipeline:
 *   1. Resolve response (model text → step text → tool results)
 *   2. Log reasoning summary
 *   3. Record cost + usage
 *   4. Write activity log
 *   5. Learn from failures
 *   6. Save response to memory
 *
 * Returns the resolved response and metadata.
 */
export async function finalizeGeneration(opts: FinalizeOptions): Promise<FinalizeResult> {
    const { text, steps, usage, reasoningCtx, modelId, channel, agent, ctx, userMessage, output } = opts;

    // 1. Resolve response
    const response = resolveAgentResponse(text, steps, output);

    // 2. Reasoning summary
    const summary = getReasoningSummary(reasoningCtx);
    const stepCount = steps?.length || 0;
    const inputTok = usage?.inputTokens || 0;
    const outputTok = usage?.outputTokens || 0;
    console.log(
        `[Agent]: Done (${stepCount} step(s), tier: ${summary.finalTier}, ` +
        `tokens: ${inputTok.toLocaleString()} in / ${outputTok.toLocaleString()} out = ${(inputTok + outputTok).toLocaleString()} total, ` +
        `failures: ${summary.toolFailures}${summary.escalated ? ', ESCALATED' : ''})`,
    );

    // 3. Record cost + usage
    let cost = 0;
    if (usage) {
        agent.getRouter().recordUsage(reasoningCtx.tier, usage.inputTokens || 0, usage.outputTokens || 0);
        const pricing = agent.getRouter().getTierPricing(reasoningCtx.tier);
        cost = ((usage.inputTokens || 0) * pricing.inputPer1M +
            (usage.outputTokens || 0) * pricing.outputPer1M) / 1_000_000;
    }

    // 4. Activity log
    logLLMCall(
        modelId,
        summary.finalTier,
        usage?.inputTokens || 0,
        usage?.outputTokens || 0,
        cost,
        stepCount,
        channel,
    );

    // 5. Learn from failures
    const failureObs = buildFailureObservation(reasoningCtx, response || '');
    if (failureObs) {
        try {
            agent.getMemoryManager().recordSelfObservation(failureObs, 'failure-learning');
        } catch { /* non-critical */ }
    }

    // 6. Postflight quality gate — check if the response actually answers the question
    let postflightResult: { shouldRetry: boolean; reason: string } | null = null;
    if (userMessage) {
        const verdict = await runPostflight(userMessage, response, agent.getRouter());
        if (verdict) {
            postflightResult = { shouldRetry: verdict.shouldRetry, reason: verdict.reason };
            if (verdict.shouldRetry) {
                console.log(`[Postflight]: Quality gate FAILED — ${verdict.reason}`);
            } else {
                console.log(`[Postflight]: Quality gate passed — ${verdict.reason}`);
            }
        }
    }

    // 7. Save to memory
    if (response) {
        agent.saveToMemory('assistant', response, ctx);
        console.log(`[Agent]: ${response.slice(0, 200)}${response.length > 200 ? '…' : ''}`);
    }

    return {
        response,
        cost,
        stepCount,
        escalated: summary.escalated,
        toolFailures: summary.toolFailures,
        postflight: postflightResult,
    };
}
