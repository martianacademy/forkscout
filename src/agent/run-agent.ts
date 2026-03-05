// src/agent/run-agent.ts — generateText-based agent runner (retryable, channel-agnostic)
import { generateText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import type { AppConfig } from "@/config.ts";
import { activity } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";
import { withRetry } from "@/llm/index.ts";
import { sanitizeForDisplay } from "@/utils/secrets.ts";
import { buildAgentParams } from "@/agent/build-params.ts";
import { wrapToolsWithProgress } from "@/agent/tool-wrappers.ts";
import { planTask, formatPlanAsContext } from "@/agent/planner.ts";
import type { TaskPlan } from "@/agent/planner.ts";
import { stripReasoning, makeLoopGuard, NUDGE_PROMPT } from "@/agent/agent-utils.ts";
import type { AgentRunOptions, AgentRunResult } from "@/agent/types.ts";

const logger = log("agent");

export async function runAgent(
    config: AppConfig,
    options: AgentRunOptions
): Promise<AgentRunResult> {
    const { tools, bootstrapTools, model, systemPrompt, messages, devtoolsEnabled } =
        await buildAgentParams(config, options);

    const { channel, chatId } = options.meta ?? {};
    const startMs = Date.now();
    const reasoningTag = config.llm.reasoningTag?.trim();

    activity.msgIn(channel ?? "unknown", chatId, sanitizeForDisplay(options.userMessage));

    // ── Optional structured planning step ─────────────────────────────────────
    let taskPlan: TaskPlan | null = null;
    let planMessages = messages;
    if (config.llm.planFirst) {
        taskPlan = await planTask(model, options.userMessage);
        if (taskPlan) {
            const planCtx = formatPlanAsContext(taskPlan);
            planMessages = [
                { role: "system", content: planCtx } as ModelMessage,
                ...messages,
            ];
        }
    }

    // ── FAKE_LLM mode — bypass real LLM, log assembled messages, return stub ─
    if (process.env.FAKE_LLM === "1") {
        logger.info(`[FAKE_LLM] messages assembled (${messages.length})`);
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i] as any;
            const preview = typeof m.content === "string"
                ? m.content.slice(0, 120)
                : JSON.stringify(m.content).slice(0, 200);
            logger.info(`  [${i}] role=${m.role} content=${preview}`);
        }
        const fakeText = `[FAKE_LLM] received ${messages.length} message(s). Latest: "${options.userMessage.slice(0, 60)}"`;
        activity.msgOut(channel ?? "unknown", chatId, fakeText, 0, Date.now() - startMs);
        return { text: fakeText, steps: 0, bootstrapToolNames: Object.keys(bootstrapTools), responseMessages: [{ role: "assistant", content: fakeText }] as ModelMessage[] };
    }

    const toolsForRun = options.onToolCall
        ? wrapToolsWithProgress(tools, options.onToolCall)
        : tools;
    const { loopAbort, stepRef, onStepFinish } = makeLoopGuard(config, options, channel, chatId, "run");

    const result = await withRetry(() => generateText({
        model, system: systemPrompt, messages: planMessages, tools: toolsForRun as any,
        stopWhen: stepCountIs(config.llm.maxSteps), maxTokens: config.llm.maxTokens,
        abortSignal: loopAbort.signal,
        ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
        onStepFinish,
    } as any), `generateText:${channel ?? "unknown"}`);

    let strippedText = stripReasoning(result.text, reasoningTag);
    let finalResult = result;

    // Auto-retry: model stopped after thinking with no visible text or tool calls.
    if (!strippedText.trim()) {
        logger.warn("[runAgent] empty text after reasoning strip — retrying with nudge");
        const retryMessages: ModelMessage[] = [
            ...planMessages, ...(result.response.messages as ModelMessage[]),
            { role: "user", content: NUDGE_PROMPT } as ModelMessage,
        ];
        try {
            const { onStepFinish: retryStep } = makeLoopGuard(config, options, channel, chatId, "run-retry");
            const retryResult = await withRetry(() => generateText({
                model, system: systemPrompt, messages: retryMessages, tools: toolsForRun as any,
                stopWhen: stepCountIs(5), maxTokens: config.llm.maxTokens,
                ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
                onStepFinish: retryStep,
            } as any), `generateText-retry:${channel ?? "unknown"}`);
            const retryText = stripReasoning(retryResult.text, reasoningTag);
            if (retryText.trim()) { strippedText = retryText; finalResult = retryResult; logger.info("[runAgent] retry succeeded"); }
            else logger.warn("[runAgent] retry also produced empty text — giving up");
        } catch (err) { logger.error(`[runAgent] retry failed: ${err}`); }
    }

    const cleanText = strippedText.trim() || "(I finished thinking but produced no response. Please ask again or rephrase.)";
    activity.msgOut(channel ?? "unknown", chatId, cleanText, finalResult.steps?.length ?? 0, Date.now() - startMs);
    return { text: cleanText, steps: finalResult.steps?.length ?? 0, bootstrapToolNames: Object.keys(bootstrapTools), responseMessages: finalResult.response.messages as ModelMessage[], ...(taskPlan ? { plan: taskPlan } : {}) };
}
