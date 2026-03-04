// src/agent/types.ts — Agent public interface types
import type { ModelMessage } from "ai";
import type { TaskPlan } from "@/agent/planner.ts";

export interface AgentRunOptions {
    userMessage: string;
    chatHistory?: ModelMessage[];
    /** Trust role of the calling user — injects role-specific instructions into the system prompt */
    role?: "owner" | "admin" | "user" | "self";
    /** Tool names to exclude from this run (e.g. restricted tools for non-owner users) */
    excludeTools?: string[];
    /** Optional channel metadata for activity logging */
    meta?: { channel?: string; chatId?: number | string; sessionKey?: string; };
    /** Abort signal — when triggered, cancels the in-flight LLM call and stream */
    abortSignal?: AbortSignal;
    /**
     * Called just before each tool executes — use to show live progress in the channel.
     * Fires with the tool name and its input. Channel-agnostic hook.
     */
    onToolCall?: (toolName: string, input: unknown) => void | Promise<void>;
    /**
     * Called after each step when the model produced reasoning tokens.
     * Works with any model that sends a separate reasoning field (DeepSeek R1, etc.)
     * Used by runAgent (non-streaming). For streamAgent, prefer onThinkingStart/Delta/End.
     */
    onThinking?: (text: string) => void | Promise<void>;
    /** Called immediately when the model begins reasoning — use for instant UI feedback. */
    onThinkingStart?: () => void | Promise<void>;
    /** Called for each reasoning token as it arrives — stream live to the UI. */
    onThinkingDelta?: (text: string) => void | Promise<void>;
    /** Called when a reasoning block ends (before text/tool output begins). */
    onThinkingEnd?: () => void | Promise<void>;
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
    /** Structured task plan produced before the run (only when config.llm.planFirst=true) */
    plan?: TaskPlan;
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
