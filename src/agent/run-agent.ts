// src/agent/run-agent.ts — Non-streaming agent runner (thin wrapper around streamAgent)
//
// All agent execution logic (planning, memory startup, retries, context-overflow
// handling, auto-save) lives in stream-agent.ts. This file simply drains the
// stream and returns the final result for callers that don't need token-by-token output.

import type { AppConfig } from "@/config.ts";
import { streamAgent } from "@/agent/stream-agent.ts";
import type { AgentRunOptions, AgentRunResult } from "@/agent/types.ts";

export async function runAgent(
    config: AppConfig,
    options: AgentRunOptions
): Promise<AgentRunResult> {
    const { textStream, finalize } = await streamAgent(config, options);
    // Drain the token stream — runAgent callers only need the final result
    for await (const _ of textStream) { /* consume */ }
    return finalize();
}
