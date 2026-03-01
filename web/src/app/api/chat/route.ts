// web/src/app/api/chat/route.ts
// Next.js API route that proxies useChat → ForkScout agent's OpenAI-compatible endpoint.
// The agent runs tools internally and streams the final text response.

import { createOpenAI } from "@ai-sdk/openai";
import { streamText, convertToModelMessages, type UIMessage } from "ai";

export const maxDuration = 300; // 5 min — agent may run multi-step tool chains

const AGENT_URL = process.env.AGENT_URL || process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3200";

export async function POST(req: Request) {
    const body = await req.json();
    const { messages, data } = body as {
        messages: UIMessage[];
        data?: { token?: string };
    };

    // Token from custom body.data or header — set by the client via DefaultChatTransport
    const token =
        data?.token ||
        req.headers.get("x-agent-token") ||
        "";

    if (!token) {
        return new Response(
            JSON.stringify({ error: "Unauthorized — no agent token provided" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
        );
    }

    // Create an OpenAI-compatible provider pointing at the ForkScout agent
    // MUST use .chat() — in AI SDK v6, agent("model") defaults to the Responses API
    // which our agent doesn't implement. .chat() uses /chat/completions.
    const agent = createOpenAI({
        baseURL: `${AGENT_URL}/v1`,
        apiKey: token,
    });

    const result = streamText({
        model: agent.chat("forkscout"),
        messages: await convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
}
