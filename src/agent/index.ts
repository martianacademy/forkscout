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

import { withRetry } from "@/llm/retry.ts";
import { sanitizeForPrompt } from "@/channels/chat-store.ts";
import { sanitizeUserMessage, sanitizeForDisplay } from "@/utils/secrets.ts";
import { stripMedia } from "@/channels/prepare-history.ts";
import { getSkills } from "@/skills/index.ts";
import { resolveSecrets, censorSecrets } from "@/secrets/vault.ts";

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

// ── Tool error safety net ────────────────────────────────────────────────────
// Catches any uncaught exception from tool execute() and returns a structured
// error object INSTEAD of throwing. This way the LLM always sees the error and
// can decide to fix the tool, try alternatives, or report.
// AI SDK v6 already catches thrown errors (tool-error type), but those arrive
// as raw JS Error objects. This wrapper makes them structured + actionable.

function wrapToolsWithErrorSafetyNet(
    tools: Record<string, any>
): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            if (typeof t.execute !== "function") return [name, t];
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    try {
                        return await original(input);
                    } catch (err: any) {
                        const message = err?.message ?? String(err);
                        const stack = err?.stack?.split("\n").slice(0, 3).join("\n") ?? "";
                        logger.error(`[tool-error] ${name}: ${message}`);

                        // Structured error the LLM can reason about
                        return {
                            success: false,
                            tool: name,
                            error: message,
                            errorType: err?.constructor?.name ?? "Error",
                            stackPreview: stack,
                            hint: classifyToolError(name, message),
                        };
                    }
                },
            }];
        })
    );
}

/** Quick heuristic to give the agent a starting point for what to do. */
function classifyToolError(toolName: string, message: string): string {
    const m = message.toLowerCase();
    if (m.includes("enoent") || m.includes("no such file")) return "File not found — check the path.";
    if (m.includes("eacces") || m.includes("permission denied")) return "Permission denied — try with different permissions or a different approach.";
    if (m.includes("econnrefused") || m.includes("enotfound")) return "Network/service unreachable — check the URL or if the service is running.";
    if (m.includes("timeout") || m.includes("etimedout")) return "Operation timed out — try again or use a shorter timeout.";
    if (m.includes("syntax error") || m.includes("unexpected token")) return "Code syntax error in tool — read the tool source and fix, or create a replacement.";
    if (m.includes("is not a function") || m.includes("is not defined")) return "Code bug in tool — a function or variable is missing. Read the tool source to fix.";
    if (m.includes("cannot read properties of") || m.includes("undefined")) return "Null reference in tool code — read the source, check for missing data.";
    if (m.includes("out of memory") || m.includes("heap")) return "Out of memory — try processing less data at once.";
    if (m.includes("spawn") || m.includes("command not found")) return "System command not found — check if the program is installed.";
    return "Read the tool source file to understand and fix the error, or create a new tool if unrecoverable.";
}

// ── Wrap tools with secret handling ──────────────────────────────────────────
// 1. RESOLVE: replace {{secret:alias}} in all string inputs before execution
// 2. CENSOR:  replace known secret values in outputs before they reach the LLM
// Applied to every tool — secrets never enter the LLM context window.

function wrapToolsWithSecretHandling(tools: Record<string, any>): Record<string, any> {
    return Object.fromEntries(
        Object.entries(tools).map(([name, t]) => {
            // Never wrap the vault tool itself — it manages secrets directly
            if (name === "secret_vault_tools" || typeof t.execute !== "function") {
                return [name, t];
            }
            const original = t.execute;
            return [name, {
                ...t,
                execute: async (input: any) => {
                    // Resolve {{secret:alias}} placeholders in any string values
                    let resolvedInput = input;
                    try {
                        const inputStr = JSON.stringify(input);
                        if (inputStr.includes("{{secret:")) {
                            resolvedInput = JSON.parse(
                                resolvedInput = inputStr.replace(
                                    /\{\{secret:([a-zA-Z0-9_\-]+)\}\}/g,
                                    (_, alias) => {
                                        const val = resolveSecrets(`{{secret:${alias}}}`);
                                        // escape for JSON string embedding
                                        return val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
                                    }
                                )
                            );
                        }
                    } catch (err) {
                        logger.warn(`[secret-wrap] ${name}: failed to resolve secrets in input: ${err}`);
                    }

                    const result = await original(resolvedInput);

                    // Censor any secret values that leaked into the output
                    try {
                        const raw = typeof result === "string" ? result : JSON.stringify(result);
                        const censored = censorSecrets(raw);
                        if (censored !== raw) {
                            logger.warn(`[secret-wrap] ${name}: censored secret value from tool output`);
                            return typeof result === "string" ? censored : JSON.parse(censored);
                        }
                    } catch {
                        // If censor fails, still return result — don't break the tool
                    }

                    return result;
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

    // Wrap every tool to resolve {{secret:alias}} in inputs and censor values in outputs
    const secretSafeTools = wrapToolsWithSecretHandling(rawTools);

    // Outermost: catch any uncaught exception and return structured error to the LLM
    const tools = wrapToolsWithErrorSafetyNet(secretSafeTools);

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
        // Wrap on top of the already-wrapped model (e.g. extractReasoningMiddleware),
        // not baseModel — otherwise the reasoning middleware chain is discarded.
        model = wrapLanguageModel({
            model: model as import("@ai-sdk/provider").LanguageModelV3,
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
    let strippedText = reasoningTag
        ? result.text.replace(new RegExp(`<${reasoningTag}>[\\s\\S]*?<\\/${reasoningTag}>\\n?`, "gi"), "").trim()
        : result.text;

    // Auto-retry: model stopped after thinking with no visible text or tool calls.
    // Inject a nudge message and run one more generateText call to force a response.
    let finalResult = result;
    if (!strippedText.trim()) {
        logger.warn("[runAgent] empty text after reasoning strip — retrying with nudge");

        const retryMessages: ModelMessage[] = [
            ...messages,
            ...(result.response.messages as ModelMessage[]),
            { role: "user", content: "[SYSTEM] You finished reasoning but produced no visible response. Respond to the user now — do NOT think silently again." } as ModelMessage,
        ];

        try {
            stepNum = 0;
            const retryResult = await withRetry(() => generateText({
                model,
                system: systemPrompt,
                messages: retryMessages,
                tools: toolsForRun as any,
                stopWhen: stepCountIs(5), // Short leash on retry
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
                    if (options.onStepFinish) {
                        const hadTools = (step.toolCalls?.length ?? 0) > 0;
                        Promise.resolve(options.onStepFinish(hadTools)).catch(() => { });
                    }
                },
            } as any), `generateText-retry:${channel ?? "unknown"}`);

            const retryText = reasoningTag
                ? retryResult.text.replace(new RegExp(`<${reasoningTag}>[\\s\\S]*?<\\/${reasoningTag}>\\n?`, "gi"), "").trim()
                : retryResult.text;

            if (retryText.trim()) {
                strippedText = retryText;
                finalResult = retryResult;
                logger.info("[runAgent] retry succeeded — got visible response");
            } else {
                logger.warn("[runAgent] retry also produced empty text — giving up");
            }
        } catch (retryErr) {
            logger.error(`[runAgent] retry failed: ${retryErr}`);
        }
    }

    const cleanText = strippedText.trim() ||
        "(I finished thinking but produced no response. Please ask again or rephrase.)";

    activity.msgOut(channel ?? "unknown", chatId, cleanText, finalResult.steps?.length ?? 0, Date.now() - startMs);

    return {
        text: cleanText,
        steps: finalResult.steps?.length ?? 0,
        bootstrapToolNames: Object.keys(bootstrapTools),
        responseMessages: finalResult.response.messages as ModelMessage[],
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
            let strippedText = reasoningTag
                ? rawText.replace(new RegExp(`<${reasoningTag}>[\\s\\S]*?<\\/${reasoningTag}>\\n?`, "gi"), "").trim()
                : rawText;

            // Auto-retry: model stopped after thinking with no visible text.
            // Fall back to a non-streaming generateText call with a nudge.
            let finalResponse = response;
            let finalSteps = steps;
            if (!strippedText.trim()) {
                logger.warn("[streamAgent] empty text after reasoning strip — retrying with nudge");

                const retryMessages: ModelMessage[] = [
                    ...messages,
                    ...((response as any).messages as ModelMessage[]),
                    { role: "user", content: "[SYSTEM] You finished reasoning but produced no visible response. Respond to the user now — do NOT think silently again." } as ModelMessage,
                ];

                try {
                    const retryResult = await withRetry(() => generateText({
                        model,
                        system: systemPrompt,
                        messages: retryMessages,
                        tools: streamTools as any,
                        stopWhen: stepCountIs(5),
                        maxTokens: config.llm.maxTokens,
                    } as any), `streamAgent-retry:${channel ?? "unknown"}`);

                    const retryText = reasoningTag
                        ? retryResult.text.replace(new RegExp(`<${reasoningTag}>[\\s\\S]*?<\\/${reasoningTag}>\\n?`, "gi"), "").trim()
                        : retryResult.text;

                    if (retryText.trim()) {
                        strippedText = retryText;
                        finalResponse = retryResult.response;
                        finalSteps = retryResult.steps;
                        logger.info("[streamAgent] retry succeeded — got visible response");
                    } else {
                        logger.warn("[streamAgent] retry also produced empty text — giving up");
                    }
                } catch (retryErr) {
                    logger.error(`[streamAgent] retry failed: ${retryErr}`);
                }
            }

            const text = strippedText.trim() ||
                "(I finished thinking but produced no response. Please ask again or rephrase.)";
            if (!strippedText.trim()) logger.warn("[streamAgent] both attempts empty — returning fallback message");
            activity.msgOut(channel ?? "unknown", chatId, text, (finalSteps as any)?.length ?? 0, Date.now() - startMs);
            return {
                text,
                steps: (finalSteps as any)?.length ?? 0,
                bootstrapToolNames: Object.keys(bootstrapTools),
                responseMessages: (finalResponse as any).messages as ModelMessage[],
            };
        },
    };
}