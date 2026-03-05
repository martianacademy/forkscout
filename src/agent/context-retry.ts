// src/agent/context-retry.ts — Progressive context-trim retry for local models with small context windows.
// Called by stream-agent.ts when a context overflow stream error is detected.

import { generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import type { AppConfig } from "@/config.ts";
import { withRetry } from "@/llm/index.ts";
import { log } from "@/logs/logger.ts";

const logger = log("agent:context-retry");

/** Minimal system prompt for last-resort retry — just enough to answer without huge preamble. */
function minimalPrompt(config: AppConfig): string {
    return `You are ${config.agent.name}. Answer the user's message as helpfully and briefly as possible.`;
}

function trimHistory(msgs: ModelMessage[], keepLast: number): ModelMessage[] {
    if (keepLast === 0) return [];                          // -0 === 0 in JS, slice(-0) returns full array
    return msgs.length <= keepLast ? msgs : msgs.slice(-keepLast);
}

export interface ContextRetryOptions {
    config: AppConfig;
    model: any;
    systemPrompt: string;
    messages: ModelMessage[];
    tools: any;
    maxTokens: number;
    reasoningTag?: string;
    channel?: string;
}

function stripReasoning(text: string, tag?: string): string {
    if (!tag) return text;
    return text.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>\\n?`, "gi"), "").trim();
}

/**
 * Progressively retries with less context until one succeeds or all fail.
 * Steps: 6 turns → 2 turns → 0 turns → 0 turns + minimal system prompt
 * Returns the first non-empty stripped text, or null if all attempts fail.
 */
export async function retryWithContextTrim(opts: ContextRetryOptions): Promise<{
    text: string | null; response: any; steps: any;
}> {
    const { config, model, systemPrompt, messages, tools, maxTokens, reasoningTag, channel } = opts;
    const label = `ctx-retry:${channel ?? "unknown"}`;
    const tag = reasoningTag?.trim();
    // Always keep at least the last message (current user input) — AI SDK rejects empty messages array
    const safeSlice = (n: number) => trimHistory(messages, n).length > 0 ? trimHistory(messages, n) : messages.slice(-1);

    const attempts: Array<{ msgs: ModelMessage[]; prompt: string; useTools: boolean; label: string }> = [
        { msgs: safeSlice(6), prompt: systemPrompt, useTools: true, label: "6 turns" },
        { msgs: safeSlice(2), prompt: systemPrompt, useTools: true, label: "2 turns" },
        { msgs: safeSlice(0), prompt: systemPrompt, useTools: false, label: "1 msg, no tools" },
        { msgs: safeSlice(0), prompt: minimalPrompt(config), useTools: false, label: "1 msg, minimal prompt" },
    ];

    for (const attempt of attempts) {
        logger.warn(`[context-retry] trying ${attempt.label} (${attempt.msgs.length} msg(s))`);
        try {
            const result = await withRetry(() => generateText({
                model,
                system: attempt.prompt,
                messages: attempt.msgs,
                ...(attempt.useTools ? { tools, stopWhen: stepCountIs(2) } : {}),
                maxTokens,
            } as any), label);

            const text = stripReasoning(result.text, tag);
            if (text.trim()) {
                logger.info(`[context-retry] succeeded with ${attempt.label}`);
                return { text, response: result.response, steps: result.steps };
            }
            logger.warn(`[context-retry] ${attempt.label} produced empty text — trying next`);
        } catch (err: any) {
            logger.warn(`[context-retry] ${attempt.label} failed: ${err?.message ?? err} — trying next`);
        }
    }

    logger.error("[context-retry] all attempts exhausted");
    return { text: null, response: { messages: [] }, steps: [] };
}
