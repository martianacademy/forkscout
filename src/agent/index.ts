// src/agent/index.ts — LLM agent runner
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { AppConfig } from "../config.ts";
import type { Tool } from "../tools/index.ts";
import { connectMcpTools } from "../mcp/index.ts";

export interface AgentRunOptions {
    userMessage: string;
    chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface AgentRunResult {
    text: string;
    steps: number;
}

export async function runAgent(
    config: AppConfig,
    options: AgentRunOptions,
    localTools: Record<string, Tool>
): Promise<AgentRunResult> {
    // Load MCP tools
    const mcpTools = await connectMcpTools(config);

    const allTools = { ...localTools, ...mcpTools };

    const openai = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY ?? "",
    });

    const model = openai(config.llm.model.replace("openrouter/", ""));

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...(options.chatHistory ?? []),
        { role: "user", content: options.userMessage },
    ];

    const result = await generateText({
        model,
        system: config.agent.systemPrompt,
        messages,
        tools: allTools as any,
        maxSteps: config.llm.maxSteps,
        maxTokens: config.llm.maxTokens,
    } as any);

    return {
        text: result.text,
        steps: result.steps?.length ?? 0,
    };
}
