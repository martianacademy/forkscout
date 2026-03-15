// src/agent/memory-hooks.ts — Infra-level memory forcing for agent sessions
//
// Two hooks:
//   1. buildMemoryStartupMessages — prepends a mandatory recall instruction for fresh sessions
//   2. autoSaveMemory             — after task completion, runs a lightweight save step
//
// These work regardless of which model or channel is used — model compliance is
// irrelevant because they are injected/triggered at the infra layer.

import { generateText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type { AppConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("memory-hooks");

// ── 1. Session startup hydration ─────────────────────────────────────────────

/**
 * For fresh sessions (≤ 2 messages = just the user's first turn), prepend a
 * mandatory system message that forces the model to call memory recall tools
 * BEFORE reading the user's request.
 *
 * This is injected AFTER the base system prompt so it is the last instruction
 * the model reads — making it the highest-priority directive.
 */
export function buildMemoryStartupMessage(
    userMessage: string,
    sessionKey: string,
    isFreshSession: boolean,
    config?: AppConfig,
): ModelMessage | null {
    if (!isFreshSession) return null;
    if (!config?.memory?.enabled) return null;

    // Extract a short topic hint from the user message (first 10 words)
    const topic = userMessage.trim().split(/\s+/).slice(0, 10).join(" ");

    const content = [
        "⚡ MANDATORY FIRST STEP — execute these tool calls NOW before reading the user message:",
        `1. memory__context  { action: "get", session_id: "${sessionKey}" }`,
        `2. memory__recall   { query: "${topic}" }`,
        "After both results are in your context, proceed with the user's request.",
        "Skipping this = hallucinating prior context. Do not skip.",
    ].join("\n");

    return { role: "system", content } as ModelMessage;
}

// ── 2. Post-task auto-save ────────────────────────────────────────────────────

export interface AutoSaveOptions {
    model: LanguageModel;
    systemMessage: string;
    conversationMessages: ModelMessage[];  // original messages
    responseMessages: ModelMessage[];      // AI SDK response.messages
    toolCallCount: number;
    sessionKey: string;
    channel?: string;
    maxTokens?: number;
    config?: AppConfig;
}

/**
 * After a task completes, runs a single lightweight generateText call that:
 *   - gets a summary of what was done
 *   - calls memory__observe + memory__context to save it
 *
 * Only fires when toolCallCount >= 2 (non-trivial task) to avoid spamming
 * memory with simple chat turns.
 *
 * Runs fire-and-forget — does NOT block the response to the user.
 * Uses a sequential queue so rapid calls don't spawn concurrent LLM requests.
 */
let saveQueue: Promise<void> = Promise.resolve();

export async function autoSaveMemory(opts: AutoSaveOptions): Promise<void> {
    if (opts.toolCallCount < 2) return; // trivial turn — skip
    if (!opts.config?.memory?.enabled) return; // memory disabled — skip

    // Enqueue — each save waits for the previous one to finish
    saveQueue = saveQueue.then(() => doSaveMemory(opts)).catch(() => {});
    return saveQueue;
}

async function doSaveMemory(opts: AutoSaveOptions): Promise<void> {
    const { model, systemMessage, conversationMessages, responseMessages, toolCallCount, sessionKey, channel, maxTokens } = opts;

    logger.info(`[memory-hooks] auto-save triggered (${toolCallCount} tool calls, session=${sessionKey})`);

    const savePrompt = [
        "MEMORY SAVE STEP — the previous task just completed.",
        "Your ONLY job now is to save what was learned:",
        "",
        "1. Call `memory__context` with:",
        `   { action: "push", session_id: "${sessionKey}", content: "<1-sentence summary of what was just done>", event_type: "action" }`,
        "",
        "2. If a bug was fixed or root cause found → call `memory__observe` with:",
        "   user: what the user asked, assistant: what you did + root cause + solution",
        "",
        "3. If a new entity/fact was discovered → call `memory__remember`",
        "",
        "4. Reply with only: `✅ memory saved` — nothing else.",
        "",
        "Skip any tool call if there is nothing meaningful to record for that category.",
    ].join("\n");

    try {
        await generateText({
            model,
            system: systemMessage,
            messages: [
                ...conversationMessages,
                ...responseMessages,
                { role: "user", content: savePrompt } as ModelMessage,
            ],
            maxSteps: 5,
            maxTokens: maxTokens ?? 512,
        } as any);
        logger.info("[memory-hooks] auto-save complete");
    } catch (err) {
        // Non-fatal — memory save failure must never affect the user response
        logger.warn(`[memory-hooks] auto-save failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Count total tool calls across AI SDK step results */
export function countToolCalls(steps: Array<{ toolCalls?: unknown[] }>): number {
    return steps.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0);
}
