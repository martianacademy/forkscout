// src/agent/stream-agent.ts — streamText-based agent runner (channel-agnostic streaming)
import { streamText, generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import type { AppConfig } from "@/config.ts";
import { activity } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";
import { withRetry } from "@/llm/index.ts";
import { sanitizeForDisplay } from "@/utils/secrets.ts";
import { buildAgentParams } from "@/agent/build-params.ts";
import { wrapToolsWithProgress } from "@/agent/tool-wrappers.ts";
import { retryWithContextTrim } from "@/agent/context-retry.ts";
import { stripReasoning, makeLoopGuard, NUDGE_PROMPT, repairToolCall } from "@/agent/agent-utils.ts";
import type { AgentRunOptions, AgentRunResult, StreamAgentResult } from "@/agent/types.ts";

const logger = log("agent");
const CONTEXT_OVERFLOW_PHRASES = ["tokens to keep from the initial prompt", "context_length", "context window", "exceeds model", "prompt is too long"];
function isContextOverflow(payload: unknown): boolean {
    const s = (typeof payload === "string" ? payload : JSON.stringify(payload ?? "")).toLowerCase();
    return CONTEXT_OVERFLOW_PHRASES.some(p => s.includes(p));
}

export async function streamAgent(
    config: AppConfig,
    options: AgentRunOptions
): Promise<StreamAgentResult> {
    const { tools, bootstrapTools, model, systemMessage, systemPrompt, messages, devtoolsEnabled } =
        await buildAgentParams(config, options);

    const { channel, chatId } = options.meta ?? {};
    const startMs = Date.now();
    const reasoningTag = config.llm.reasoningTag?.trim();
    activity.msgIn(channel ?? "unknown", chatId, sanitizeForDisplay(options.userMessage));

    const streamTools = options.onToolCall
        ? wrapToolsWithProgress(tools, options.onToolCall)
        : tools;
    const { loopAbort, onStepFinish } = makeLoopGuard(config, options, channel, chatId, "stream");

    const stream = streamText({
        model, system: systemMessage, messages, tools: streamTools as any,
        stopWhen: stepCountIs(config.llm.maxSteps), maxTokens: config.llm.maxTokens,
        abortSignal: loopAbort.signal,
        ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
        experimental_repairToolCall: repairToolCall,
        onStepFinish,
    } as any);

    // Accumulate text here — stream.text throws "No output generated" after fullStream consumed (AI SDK v6 bug)
    const acc = { text: "" };
    let contextOverflow = false;

    async function* loggedTokenStream(): AsyncIterable<string> {
        let reasoningActive = false;
        const closeReasoning = async () => {
            if (!reasoningActive) return;
            reasoningActive = false;
            if (options.onThinkingEnd) { try { await options.onThinkingEnd(); } catch { /* never block stream */ } }
        };
        for await (const part of (stream as any).fullStream as AsyncIterable<import("ai").TextStreamPart<any>>) {
            if (part.type === "text-delta") {
                const delta = part.text ?? "";
                if (!delta) continue;
                if (reasoningActive) await closeReasoning();
                acc.text += delta;
                activity.token(delta, channel, chatId);
                yield delta;
            } else if (part.type === "reasoning-delta" && part.text) {
                if (options.onThinkingDelta) { try { await options.onThinkingDelta(part.text); } catch { /* never block stream */ } }
            } else if (part.type === "reasoning-start") {
                if (reasoningActive) await closeReasoning();
                reasoningActive = true;
                if (options.onThinkingStart) { try { await options.onThinkingStart(); } catch { /* never block stream */ } }
            } else if (part.type === "error") {
                const errPayload = part.error ?? part;
                logger.warn(`[stream] non-fatal stream error: ${JSON.stringify(errPayload)}`);
                if (isContextOverflow(errPayload)) contextOverflow = true;
            }
        }

        if (reasoningActive) await closeReasoning();
    }

    return {
        textStream: loggedTokenStream(),
        bootstrapToolNames: Object.keys(bootstrapTools),
        async finalize(): Promise<AgentRunResult> {
            let response: any;
            let steps: any;
            try {
                [response, steps] = await Promise.all([stream.response, stream.steps]);
            } catch (err: any) {
                // Stream was aborted (loop-guard) — use accumulated text and empty steps
                logger.warn(`[streamAgent] finalize: stream.response threw (likely aborted): ${err?.message ?? err}`);
                response = { messages: [] };
                steps = [];
            }
            let strippedText = stripReasoning(acc.text, reasoningTag);
            let finalResponse = response;
            let finalSteps = steps;

            if (!strippedText.trim()) {
                if (contextOverflow) {
                    logger.warn("[streamAgent] context overflow — delegating to context-retry");
                    const { text: rt, response: rr, steps: rs } = await retryWithContextTrim({
                        config, model, systemMessage, messages, tools: streamTools as any,
                        maxTokens: config.llm.maxTokens, reasoningTag, channel,
                    });
                    if (rt) { strippedText = rt; finalResponse = rr; finalSteps = rs; }
                    else strippedText = "⚠️ This conversation is too long for the current model's context window. Please start a new chat or use /new to clear history.";
                } else {
                    // No output but no overflow — nudge the model to respond
                    logger.warn("[streamAgent] empty text after reasoning strip — retrying with nudge");
                    const retryMessages: ModelMessage[] = [
                        ...messages, ...((response as any).messages as ModelMessage[]),
                        { role: "user", content: NUDGE_PROMPT } as ModelMessage,
                    ];
                    try {
                        const { onStepFinish: retryStep } = makeLoopGuard(config, options, channel, chatId, "stream-retry");
                        const retryResult = await withRetry(() => generateText({
                            model, system: systemMessage, messages: retryMessages, tools: streamTools as any,
                            stopWhen: stepCountIs(5), maxTokens: config.llm.maxTokens,
                            experimental_repairToolCall: repairToolCall,
                            onStepFinish: retryStep,
                        } as any), `streamAgent-retry:${channel ?? "unknown"}`);
                        const retryText = stripReasoning(retryResult.text, reasoningTag);
                        if (retryText.trim()) {
                            strippedText = retryText; finalResponse = retryResult.response; finalSteps = retryResult.steps;
                            logger.info("[streamAgent] nudge retry succeeded");
                        } else logger.warn("[streamAgent] nudge retry also produced empty text — giving up");
                    } catch (err) { logger.error(`[streamAgent] retry failed: ${err}`); }
                }
            }

            const text = strippedText.trim() || "(I finished thinking but produced no response. Please ask again or rephrase.)";
            activity.msgOut(channel ?? "unknown", chatId, text, (finalSteps as any)?.length ?? 0, Date.now() - startMs);
            return { text, steps: (finalSteps as any)?.length ?? 0, bootstrapToolNames: Object.keys(bootstrapTools), responseMessages: (finalResponse as any).messages as ModelMessage[] };
        },
    };
}
