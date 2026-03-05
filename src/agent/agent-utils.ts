// src/agent/agent-utils.ts — Shared utilities for runAgent and streamAgent.
// Extracted to eliminate ~60 lines of duplication between the two runners.

import type { AppConfig } from "@/config.ts";
import { activity } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";
import type { AgentRunOptions } from "@/agent/types.ts";

const logger = log("agent");

export const NUDGE_PROMPT =
    "[SYSTEM] You finished reasoning but produced no visible response. Respond to the user now — do NOT think silently again.";

export function stripReasoning(text: string, tag?: string): string {
    if (!tag) return text;
    return text.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>\\n?`, "gi"), "").trim();
}

/**
 * Creates a loop-guard abort controller + onStepFinish handler shared by both runners.
 * Handles: activity logging, reasoning logging, loop detection, fail-streak detection.
 * `abortLabel` is "run" or "stream" — appears in warning messages only.
 */
export function makeLoopGuard(
    config: AppConfig,
    options: AgentRunOptions,
    channel: string | undefined,
    chatId: string | number | undefined,
    abortLabel: string,
) {
    const loopAbort = new AbortController();
    if (options.abortSignal) options.abortSignal.addEventListener("abort", () => loopAbort.abort());
    const guard = { lastTool: "", lastInputHash: "", count: 0, failStreak: 0 };
    const stepRef = { n: 0 };

    function onStepFinish(step: any) {
        stepRef.n++;
        const n = stepRef.n;
        if (typeof step.reasoningText === "string" && step.reasoningText.trim()) {
            logger.info(`[thinking step ${n}]\n${step.reasoningText.trim()}`);
        }
        if (options.onThinking && typeof step.reasoningText === "string" && step.reasoningText.trim()) {
            Promise.resolve(options.onThinking(step.reasoningText.trim())).catch(() => { });
        }
        for (const tc of step.toolCalls ?? []) activity.toolCall(tc.toolName, tc.input, "agent", n);
        for (const tr of step.toolResults ?? []) activity.toolResult(tr.toolName, tr.output, undefined, "agent", n);
        if (options.onStepFinish) {
            Promise.resolve(options.onStepFinish((step.toolCalls?.length ?? 0) > 0)).catch(() => { });
        }

        const toolNames = (step.toolCalls ?? []).map((t: any) => t.toolName);
        const max = config.llm.loopGuardMaxConsecutive ?? 3;
        if (toolNames.length === 1) {
            const hash = JSON.stringify((step.toolCalls ?? [])[0]?.input ?? {});
            if (toolNames[0] === guard.lastTool && hash === guard.lastInputHash) {
                if (++guard.count >= max) {
                    logger.warn(`[loop-guard] "${guard.lastTool}" called ${guard.count}x with identical input — aborting ${abortLabel}`);
                    loopAbort.abort();
                }
            } else { guard.lastTool = toolNames[0]; guard.lastInputHash = hash; guard.count = 1; }
        } else { guard.count = 0; guard.lastTool = ""; guard.lastInputHash = ""; }

        const results = step.toolResults ?? [];
        const partialOk = results.some((r: any) => {
            const o = r?.result ?? r?.output;
            return o?.stopped_early === true && (o?.failed_count ?? 0) < (o?.results?.length ?? 1);
        });
        const allFailed = !partialOk && results.length > 0 &&
            results.every((r: any) => r?.result?.success === false || r?.output?.success === false);
        if (allFailed) {
            if (++guard.failStreak >= max) {
                logger.warn(`[loop-guard] all tools failed ${guard.failStreak}x — aborting ${abortLabel}`);
                loopAbort.abort();
            }
        } else { guard.failStreak = 0; }
    }

    return { loopAbort, stepRef, onStepFinish };
}
