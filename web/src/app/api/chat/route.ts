// web/src/app/api/chat/route.ts
// Next.js API route that proxies useChat → ForkScout agent's OpenAI-compatible endpoint.
// The agent runs tools internally and streams the final text response.
// Auth: Clerk JWT — userId extracted and sent to agent as X-User-Id header.

import { auth } from "@clerk/nextjs/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, convertToModelMessages, type UIMessage } from "ai";

export const maxDuration = 300; // 5 min — agent may run multi-step tool chains

const AGENT_URL = process.env.AGENT_URL || process.env.NEXT_PUBLIC_AGENT_URL || "http://localhost:3200";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "forkscout-internal";

export async function POST(req: Request) {
    const { userId } = await auth();

    if (!userId) {
        return new Response(
            JSON.stringify({ error: "Unauthorized — not signed in" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
        );
    }

    const body = await req.json();
    const { messages } = body as { messages: UIMessage[] };

    // Create an OpenAI-compatible provider pointing at the ForkScout agent
    // MUST use .chat() — in AI SDK v6, agent("model") defaults to the Responses API
    // which our agent doesn't implement. .chat() uses /chat/completions.
    const agent = createOpenAI({
        baseURL: `${AGENT_URL}/v1`,
        apiKey: INTERNAL_SECRET,
        headers: {
            "X-User-Id": userId,
        },
    });

    const result = streamText({
        model: agent.chat("forkscout"),
        messages: await convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
}
