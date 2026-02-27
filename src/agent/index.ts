// src/agent/index.ts — LLM agent runner
import { generateText, streamText, wrapLanguageModel, stepCountIs, extractReasoningMiddleware, type ModelMessage } from "ai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "@/config.ts";
import { getProvider } from "@/providers/index.ts";
import { discoverTools } from "@/tools/index.ts";
import { discoverMcpTools } from "@/mcp-servers/index.ts";
import { buildIdentity, type IdentityContext } from "@/agent/system-prompts/identity.ts";
import { activity } from "@/logs/activity-log.ts";
import { log } from "@/logs/logger.ts";
import { compressIfLong } from "@/utils/extractive-summary.ts";
import { llmSummarize } from "@/llm/summarize.ts";
import { withRetry } from "@/llm/retry.ts";
import { sanitizeForPrompt } from "@/channels/chat-store.ts";
import { sanitizeUserMessage, sanitizeForDisplay } from "@/utils/secrets.ts";
import { stripMedia } from "@/channels/prepare-history.ts";
import { getSkills } from "@/skills/index.ts";

// ── Role extension loader ─────────────────────────────────────────────────────
// Reads the appropriate role-.md file and returns its content to inject into the
// system prompt. Owner gets no extra restrictions — they already have full trust.

const EXTENSIONS_DIR = resolve(import.meta.dir, "system-prompts/extensions");

function loadRoleExtension(role: "owner" | "admin" | "user" | "self"): string {
    if (role === "owner" || role === "self") return "";
    const file = resolve(EXTENSIONS_DIR, `role-${role}.md`);
    try {
        return readFileSync(file, "utf-8").trim();
    } catch {
        return "";
    }
}

const logger = log("agent");


export interface AgentRunOptions {
    userMessage: string;
    chatHistory?: ModelMessage[];
    /** Trust role of the calling user — injects role-specific instructions into the system prompt */
    role?: "owner" | "admin" | "user" | "self";
    /** Tool names to exclude from this run (e.g. restricted tools for non-owner users) */
    excludeTools?: string[];
    /** Optional channel metadata for activity logging */
    meta?: { channel?: string; chatId?: number | string; };
    /**
     * Called just before each tool executes — use to show live progress in the channel.
     * Fires with the tool name and its input. Channel-agnostic hook.
     */
    onToolCall?: (toolName: string, input: unknown) => void | Promise<void>;
    /**
     * Called after each step when the model produced reasoning tokens.
     * Fires with the full reasoning text for that step.
     * Works with any model that sends a separate reasoning field (OpenRouter Minimax M2.5,
     * DeepSeek R1, etc.) — the AI SDK maps delta.reasoning → step.reasoningText automatically.
     */
    onThinking?: (text: string) => void | Promise<void>;
    /**
     * Called after each agentic step completes.
     * `hadToolCalls` is true when the step invoked at least one tool.
     * Use this to clean up tool-progress UI (e.g. delete a tool bubble).
     */
    onStepFinish?: (hadToolCalls: boolean) => void | Promise<void>;
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
    const threshold = config.llm.toolResultAutoCompressWords ?? 400;
    const maxSumTokens = config.llm.llmSummarizeMaxTokens ?? 1200;

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

// ── Wrap tools with progress hook ────────────────────────────────────────────
// Fires onToolCall before each tool executes so the channel can show live progress.

function wrapToolsWithProgress(
    tools: Record<string, any>,
    onToolCall: (name: string, input: unknown) => void | Promise<void>
): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            if (typeof t.execute !== "function") return [name, t];
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    try { await onToolCall(name, input); } catch { /* never block tool on hook error */ }
                    return original(input);
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
    const skills = getSkills(config);

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

    // Extract unique MCP server names from tool keys (format: <server>__<tool>)
    const mcpServers = [...new Set(
        Object.keys(mcpTools)
            .map((k) => k.split("__")[0])
            .filter(Boolean)
    )];

    const ctx: IdentityContext = {
        channel: options.meta?.channel,
        model: `${provider}/${modelId}`,
        mcpServers,
        toolCount: Object.keys(tools).length,
        skills,
    };

    // Dev-only: wrap with AI SDK DevTools middleware when DEVTOOLS=1
    // Run the UI separately: bun devtools  →  http://localhost:4983
    let model: typeof baseModel = baseModel;

    // Apply extractReasoningMiddleware when reasoningTag is configured.
    // The fetch transform (in the provider) injects reasoning as <think>...</think>
    // inside message.content. This middleware then lifts those tags out into
    // step.reasoning / step.reasoningText so onThinking can fire correctly.
    const reasoningTag = config.llm.reasoningTag?.trim();
    if (reasoningTag) {
        model = wrapLanguageModel({
            model: baseModel as import("@ai-sdk/provider").LanguageModelV3,
            middleware: extractReasoningMiddleware({ tagName: reasoningTag }),
        }) as typeof model;
    }

    const devtoolsEnabled = process.env.DEVTOOLS === "1";
    if (devtoolsEnabled) {
        const { devToolsMiddleware } = await import("@ai-sdk/devtools");
        model = wrapLanguageModel({
            model: baseModel as import("@ai-sdk/provider").LanguageModelV3,
            middleware: devToolsMiddleware(),
        }) as typeof baseModel;
    }

    const basePrompt = config.agent.systemPromptExtra
        ? `${buildIdentity(config, ctx)}\n\n${config.agent.systemPromptExtra}`
        : buildIdentity(config, ctx);

    const roleExtension = options.role ? loadRoleExtension(options.role) : "";
    const systemPrompt = roleExtension
        ? `${basePrompt}\n\n---\n\n## Active Role Instructions\n\n${roleExtension}`
        : basePrompt;

    const messages: ModelMessage[] = [
        // Raw history from disk → sanitize for schema validity → strip media → LLM
        ...stripMedia(sanitizeForPrompt(options.chatHistory ?? [])),
        { role: "user", content: sanitizeUserMessage(options.userMessage) },
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

    activity.msgIn(channel ?? "unknown", chatId, sanitizeForDisplay(options.userMessage));

    // ── FAKE_LLM mode — bypass real LLM, log assembled messages, return stub ─
    if (process.env.FAKE_LLM === "1") {
        logger.info(`[FAKE_LLM] messages assembled (${messages.length}):`);
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i] as any;
            const preview = typeof m.content === "string"
                ? m.content.slice(0, 120)
                : JSON.stringify(m.content).slice(0, 200);
            logger.info(`  [${i}] role=${m.role} content=${preview}`);
        }
        logger.info(`[FAKE_LLM] full dump:\n${JSON.stringify(messages, null, 2)}`);
        const fakeText = `[FAKE_LLM] received ${messages.length} message(s). History: ${messages.length - 1} prior, latest: "${options.userMessage.slice(0, 60)}"`;
        activity.msgOut(channel ?? "unknown", chatId, fakeText, 0, Date.now() - startMs);
        return {
            text: fakeText,
            steps: 0,
            bootstrapToolNames: Object.keys(bootstrapTools),
            responseMessages: [{ role: "assistant", content: fakeText }] as ModelMessage[],
        };
    }

    let stepNum = 0;

    // Wrap with progress hook if caller provided one (e.g. Telegram live status)
    const toolsForRun = options.onToolCall
        ? wrapToolsWithProgress(tools, options.onToolCall)
        : tools;

    const result = await withRetry(() => generateText({
        model,
        system: systemPrompt,
        messages,
        tools: toolsForRun as any,
        stopWhen: stepCountIs(config.llm.maxSteps),
        maxTokens: config.llm.maxTokens,
        ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
        onStepFinish(step: any) {
            stepNum++;
            if (typeof step.reasoningText === "string" && step.reasoningText.trim()) {
                logger.info(`[thinking step ${stepNum}]\n${step.reasoningText.trim()}`);
            }
            if (options.onThinking && typeof step.reasoningText === "string" && step.reasoningText.trim()) {
                Promise.resolve(options.onThinking(step.reasoningText.trim())).catch(() => { });
            }
            for (const tc of step.toolCalls ?? []) {
                activity.toolCall(tc.toolName, tc.input, "agent", stepNum);
            }
            for (const tr of step.toolResults ?? []) {
                activity.toolResult(tr.toolName, tr.output, undefined, "agent", stepNum);
            }
            if (options.onStepFinish) {
                const hadTools = (step.toolCalls?.length ?? 0) > 0;
                Promise.resolve(options.onStepFinish(hadTools)).catch(() => { });
            }
        },
    } as any), `generateText:${channel ?? "unknown"}`);

    // Strip any leaked <think>...</think> blocks from the final text.
    // extractReasoningMiddleware should handle this, but on the non-streaming
    // path it can leak into result.text — strip as a safety net.
    const reasoningTag = config.llm.reasoningTag?.trim();
    const cleanText = reasoningTag
        ? result.text.replace(new RegExp(`<${reasoningTag}>[\\s\\S]*?<\\/${reasoningTag}>\\n?`, "gi"), "").trim()
        : result.text;

    activity.msgOut(channel ?? "unknown", chatId, cleanText, result.steps?.length ?? 0, Date.now() - startMs);

    return {
        text: cleanText,
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

    activity.msgIn(channel ?? "unknown", chatId, sanitizeForDisplay(options.userMessage));

    let streamStep = 0;

    // Apply progress + onToolCall hooks if caller provided them
    const streamTools = options.onToolCall
        ? wrapToolsWithProgress(tools, options.onToolCall)
        : tools;

    const stream = streamText({
        model,
        system: systemPrompt,
        messages,
        tools: streamTools as any,
        stopWhen: stepCountIs(config.llm.maxSteps),
        maxTokens: config.llm.maxTokens,
        ...(devtoolsEnabled && { experimental_telemetry: { isEnabled: true } }),
        onStepFinish(step: any) {
            streamStep++;
            if (typeof step.reasoningText === "string" && step.reasoningText.trim()) {
                logger.info(`[thinking step ${streamStep}]\n${step.reasoningText.trim()}`);
            }
            if (options.onThinking && typeof step.reasoningText === "string" && step.reasoningText.trim()) {
                Promise.resolve(options.onThinking(step.reasoningText.trim())).catch(() => { });
            }
            for (const tc of step.toolCalls ?? []) {
                activity.toolCall(tc.toolName, tc.input, "agent", streamStep);
            }
            for (const tr of step.toolResults ?? []) {
                activity.toolResult(tr.toolName, tr.output, undefined, "agent", streamStep);
            }
            if (options.onStepFinish) {
                const hadTools = (step.toolCalls?.length ?? 0) > 0;
                Promise.resolve(options.onStepFinish(hadTools)).catch(() => { });
            }
        },
    } as any);

    const reasoningTag = config.llm.reasoningTag?.trim();

    // Shared accumulator — loggedTokenStream writes text here; finalize() reads
    // it instead of stream.text (which throws "No output generated" when fullStream
    // was already consumed — AI SDK v6 dual-consumption bug).
    const acc = { text: "" };

    // Consume fullStream so we can intercept both text-delta and reasoning-delta.
    // extractReasoningMiddleware strips <think> from the text stream and emits
    // reasoning-delta chunks — we forward those to onThinking live as they arrive.
    async function* loggedTokenStream(): AsyncIterable<string> {
        let accumulatedReasoning = "";
        let reasoningTimer: ReturnType<typeof setTimeout> | null = null;

        const flushReasoning = async () => {
            if (!options.onThinking || !accumulatedReasoning) return;
            const snapshot = accumulatedReasoning;
            try { await options.onThinking(snapshot); } catch { /* never block stream */ }
        };

        const scheduleFlush = () => {
            if (reasoningTimer) clearTimeout(reasoningTimer);
            reasoningTimer = setTimeout(() => {
                reasoningTimer = null;
                flushReasoning().catch(() => { });
            }, 600);
        };

        for await (const part of (stream as any).fullStream as AsyncIterable<import("ai").TextStreamPart<any>>) {
            if (part.type === "text-delta") {
                const delta = part.text ?? "";
                if (!delta) continue;
                // Flush pending reasoning before first text token
                if (reasoningTimer) {
                    clearTimeout(reasoningTimer);
                    reasoningTimer = null;
                    await flushReasoning();
                    accumulatedReasoning = "";
                }
                acc.text += delta;
                activity.token(delta, channel, chatId);
                process.stdout.write(delta);
                yield delta;
            } else if (part.type === "reasoning-delta" && part.text) {
                // Live reasoning chunks — log immediately + accumulate for onThinking debounce
                process.stdout.write(`\x1b[2m${part.text}\x1b[0m`); // dim text in terminal
                if (options.onThinking) {
                    accumulatedReasoning += part.text;
                    scheduleFlush();
                }
            } else if (part.type === "reasoning-start") {
                accumulatedReasoning = "";
                process.stdout.write("\n\x1b[2m[thinking]\x1b[0m ");
            } else if (part.type === "start-step") {
                process.stdout.write(`\n\x1b[90m── step ${streamStep + 1} ──\x1b[0m\n`);
            } else if (part.type === "error") {
                logger.warn(`[stream] non-fatal stream error: ${JSON.stringify(part.error ?? part)}`);
                // Continue — don't abort the stream for a single bad chunk
            }
        }

        if (reasoningTimer) { clearTimeout(reasoningTimer); await flushReasoning(); }
        process.stdout.write("\n");
    }

    return {
        textStream: loggedTokenStream(),
        bootstrapToolNames: Object.keys(bootstrapTools),
        async finalize(): Promise<AgentRunResult> {
            // stream.response and stream.steps are safe to await after fullStream
            // is consumed. stream.text is NOT — use acc.text instead.
            const [response, steps] = await Promise.all([
                stream.response,
                stream.steps,
            ]);
            const rawText = acc.text;
            const text = reasoningTag
                ? rawText.replace(new RegExp(`<${reasoningTag}>[\\s\\S]*?<\\/${reasoningTag}>\\n?`, "gi"), "").trim()
                : rawText;
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