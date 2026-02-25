// src/agent/index.ts — LLM agent runner
import { generateText, streamText, wrapLanguageModel, stepCountIs, type ModelMessage } from "ai";
import type { AppConfig } from "@/config.ts";
import { getProvider } from "@/providers/index.ts";
import { discoverTools } from "@/tools/index.ts";
import { discoverMcpTools } from "@/mcp-servers/index.ts";
import { buildIdentity } from "@/agent/system-prompts/identity.ts";
import { activity } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";
import { compressIfLong } from "@/utils/extractive-summary.ts";
import { llmSummarize } from "@/llm/summarize.ts";

const logger = log("agent");

export interface AgentRunOptions {
    userMessage: string;
    chatHistory?: ModelMessage[];
    /** Tool names to exclude from this run (e.g. restricted tools for non-owner users) */
    excludeTools?: string[];
    /** Optional channel metadata for activity logging */
    meta?: { channel?: string; chatId?: number | string; };
}

export interface AgentRunResult {
    text: string;
    steps: number;
    bootstrapToolNames: string[];
    /** Full messages from this turn (including tool calls/results) — append to history */
    responseMessages: ModelMessage[];
}

export interface StreamAgentResult {
    /** Token-by-token text stream — pipe to stdout or edit a Telegram message */
    textStream: AsyncIterable<string>;
    bootstrapToolNames: string[];
    /**
     * Resolves after the stream is fully consumed.
     * Contains final text, step count, and messages to append to chat history.
     */
    finalize(): Promise<AgentRunResult>;
}

// ── Auto-compress tool results ───────────────────────────────────────────────
// Wraps every tool's execute() so oversized results are compressed BEFORE
// being returned to the LLM — the raw content never enters the context window.

function wrapToolsWithAutoCompress(
    tools: Record<string, any>,
    config: AppConfig
): Record<string, any> {
    const threshold = config.llm.toolResultAutoCompressWords;
    const maxSumTokens = config.llm.llmSummarizeMaxTokens;

    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            // Never wrap compress_text itself — avoid recursion
            if (name === "compress_text" || typeof t.execute !== "function") {
                return [name, t];
            }
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    const result = await original(input);
                    const raw = typeof result === "string" ? result : JSON.stringify(result);
                    const words = raw.split(/\s+/).filter(Boolean).length;

                    if (words <= threshold) return result;

                    if (words > 2000) {
                        // LLM synthesis for very large results
                        logger.info(`[auto-compress] ${name}: ${words} words → llm summarise`);
                        const summary = await llmSummarize(raw, { maxOutputTokens: maxSumTokens });
                        return { __compressed: "llm", originalWords: words, result: summary };
                    } else {
                        // Extractive for moderate results — fast and free
                        logger.info(`[auto-compress] ${name}: ${words} words → extractive`);
                        const summary = compressIfLong(raw, threshold * 5, 12);
                        return { __compressed: "extractive", originalWords: words, result: summary };
                    }
                },
            }];
        })
    );
}

// ── Shared setup ─────────────────────────────────────────────────────────────

async function buildAgentParams(config: AppConfig, options: AgentRunOptions) {
    const [{ allTools, bootstrapTools }, mcpTools] = await Promise.all([
        discoverTools(),
        discoverMcpTools(),
    ]);

    // Filter out excluded tools (e.g. owner-only tools for regular users)
    const excluded = new Set(options.excludeTools ?? []);
    const rawTools = Object.fromEntries(
        Object.entries({ ...allTools, ...mcpTools }).filter(([k]) => !excluded.has(k))
    );

    // Wrap every tool's execute() to auto-compress large results before they enter the LLM context
    const tools = wrapToolsWithAutoCompress(rawTools, config);

    const { provider, tier, providers } = config.llm;
    const modelId = providers[provider][tier];
    const baseModel = getProvider(provider).chat(modelId);

    // Dev-only: wrap with AI SDK DevTools middleware when DEVTOOLS=1
    // Run the UI separately: bun devtools  →  http://localhost:4983
    let model: typeof baseModel = baseModel;
    const devtoolsEnabled = process.env.DEVTOOLS === "1";
    if (devtoolsEnabled) {
        const { devToolsMiddleware } = await import("@ai-sdk/devtools");
        model = wrapLanguageModel({
            model: baseModel as import("@ai-sdk/provider").LanguageModelV3,
            middleware: devToolsMiddleware(),
        }) as typeof baseModel;
    }

    const systemPrompt = config.agent.systemPromptExtra
        ? `${buildIdentity(config)}\n\n${config.agent.systemPromptExtra}`
        : buildIdentity(config);

    const messages: ModelMessage[] = [
        ...(options.chatHistory ?? []),
        { role: "user", content: options.userMessage },
    ];

    return { tools, bootstrapTools, model, systemPrompt, messages, devtoolsEnabled };
}

// ── generateText — simple, retryable, channel-agnostic ───────────────────────

export async function runAgent(
    config: AppConfig,
    options: AgentRunOptions
): Promise<AgentRunResult> {
    const { tools, bootstrapTools, model, systemPrompt, messages, devtoolsEnabled } =
        await buildAgentParams(config, options);

    const { channel, chatId } = options.meta ?? {};
    const startMs = Date.now();

    activity.msgIn(channel ?? "unknown", chatId, options.userMessage);

    let stepNum = 0;
    const { provider, tier } = config.llm;
    const modelId = config.llm.providers[provider]?.[tier];
    const toolNames = Object.keys(await discoverMcpTools()).concat(Object.keys((await discoverTools()).allTools));
    console.log(`[agent] model: ${provider}/${modelId} | tools: ${toolNames.length} (${toolNames.filter(t => t.includes("__")).length} mcp)`);

    const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools: tools as any,
        stopWhen: stepCountIs(config.llm.maxSteps),
        maxTokens: config.llm.maxTokens,
        ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
        onStepFinish(step: any) {
            stepNum++;
            for (const tc of step.toolCalls ?? []) {
                activity.toolCall(tc.toolName, tc.input, "agent", stepNum);
            }
            for (const tr of step.toolResults ?? []) {
                activity.toolResult(tr.toolName, tr.output, undefined, "agent", stepNum);
            }
        },
    } as any);

    activity.msgOut(channel ?? "unknown", chatId, result.text, result.steps?.length ?? 0, Date.now() - startMs);

    return {
        text: result.text,
        steps: result.steps?.length ?? 0,
        bootstrapToolNames: Object.keys(bootstrapTools),
        responseMessages: result.response.messages as ModelMessage[],
    };
}

// ── streamText — for channels that want live token output ────────────────────

export async function streamAgent(
    config: AppConfig,
    options: AgentRunOptions
): Promise<StreamAgentResult> {
    const { tools, bootstrapTools, model, systemPrompt, messages, devtoolsEnabled } =
        await buildAgentParams(config, options);

    const { channel, chatId } = options.meta ?? {};
    const startMs = Date.now();

    activity.msgIn(channel ?? "unknown", chatId, options.userMessage);

    let streamStep = 0;
    const stream = streamText({
        model,
        system: systemPrompt,
        messages,
        tools: tools as any,
        stopWhen: stepCountIs(config.llm.maxSteps),
        maxTokens: config.llm.maxTokens,
        ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
        onStepFinish(step: any) {
            streamStep++;
            for (const tc of step.toolCalls ?? []) {
                activity.toolCall(tc.toolName, tc.input, "agent", streamStep);
            }
            for (const tr of step.toolResults ?? []) {
                activity.toolResult(tr.toolName, tr.output, undefined, "agent", streamStep);
            }
        },
    } as any);

    // Wrap textStream to intercept every token chunk for the activity log
    async function* loggedTokenStream(): AsyncIterable<string> {
        for await (const chunk of stream.textStream) {
            activity.token(chunk, channel, chatId);
            yield chunk;
        }
    }

    return {
        textStream: loggedTokenStream(),
        bootstrapToolNames: Object.keys(bootstrapTools),
        async finalize(): Promise<AgentRunResult> {
            const [text, response, steps] = await Promise.all([
                stream.text,
                stream.response,
                stream.steps,
            ]);
            activity.msgOut(channel ?? "unknown", chatId, text, (steps as any)?.length ?? 0, Date.now() - startMs);
            return {
                text,
                steps: (steps as any)?.length ?? 0,
                bootstrapToolNames: Object.keys(bootstrapTools),
                responseMessages: (response as any).messages as ModelMessage[],
            };
        },
    };
}