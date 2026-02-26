// src/providers/reasoning-fetch-transform.ts — Fetch middleware: injects <think> reasoning tags into streamed LLM responses.
//
// Fetch wrapper that transforms OpenRouter's (and compatible providers') non-standard
// `message.reasoning` / `delta.reasoning` field into <think>...</think> tags inside
// `message.content` / `delta.content`.
//
// Why: The AI SDK's @ai-sdk/openai parser only reads `message.content` and `delta.content`.
// OpenRouter returns thinking in a separate `reasoning` field which the SDK silently drops.
// By injecting the reasoning into content as tagged text BEFORE the SDK parses the response,
// extractReasoningMiddleware can then lift it out as proper reasoning-delta chunks and
// step.reasoningText becomes populated.
//
// Handles both:
//   - Non-streaming (JSON): choices[i].message.reasoning → prepend to message.content
//   - Streaming (SSE):      delta.reasoning → inject into delta.content with <think> tags

/** Wraps fetch to intercept reasoning fields from any OpenAI-compatible provider. */
export function makeReasoningFetch(tagName: string): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
    const openTag = `<${tagName}>`;
    const closeTag = `</${tagName}>`;

    return async function reasoningFetch(
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> {
        const response = await fetch(input, init);

        // Only transform successful JSON/SSE responses
        if (!response.ok) return response;

        const contentType = response.headers.get("content-type") ?? "";

        // ── Non-streaming JSON response ──────────────────────────────────────
        if (contentType.includes("application/json")) {
            const body = await response.json() as any;
            if (Array.isArray(body?.choices)) {
                for (const choice of body.choices) {
                    const msg = choice?.message;
                    if (!msg) continue;
                    const reasoning: string | undefined = msg.reasoning;
                    if (typeof reasoning === "string" && reasoning.trim()) {
                        const existing = typeof msg.content === "string" ? msg.content : "";
                        msg.content = `${openTag}${reasoning}${closeTag}\n${existing}`;
                        // Clear original field so SDK doesn't get confused
                        delete msg.reasoning;
                        delete msg.reasoning_details;
                    }
                }
            }
            return new Response(JSON.stringify(body), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        }

        // ── Streaming SSE response ───────────────────────────────────────────
        if (contentType.includes("text/event-stream")) {
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let reasoningOpen = false; // have we opened <think> but not yet closed it?

            const stream = new ReadableStream({
                async pull(controller) {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            // If stream ended mid-reasoning block, close it
                            if (reasoningOpen) {
                                const synthetic = `data: ${JSON.stringify({
                                    choices: [{ delta: { content: closeTag }, index: 0 }]
                                })}\n\n`;
                                controller.enqueue(new TextEncoder().encode(synthetic));
                                reasoningOpen = false;
                            }
                            controller.close();
                            return;
                        }

                        const text = decoder.decode(value, { stream: true });
                        const lines = text.split("\n");
                        const outLines: string[] = [];

                        for (const line of lines) {
                            if (!line.startsWith("data: ")) {
                                outLines.push(line);
                                continue;
                            }
                            const json = line.slice(6).trim();
                            if (json === "[DONE]") {
                                if (reasoningOpen) {
                                    // Close block just before [DONE]
                                    outLines.push(`data: ${JSON.stringify({
                                        choices: [{ delta: { content: closeTag }, index: 0 }]
                                    })}`);
                                    reasoningOpen = false;
                                }
                                outLines.push(line);
                                continue;
                            }

                            let chunk: any;
                            try { chunk = JSON.parse(json); } catch {
                                outLines.push(line);
                                continue;
                            }

                            const choice = chunk?.choices?.[0];
                            if (!choice) { outLines.push(line); continue; }

                            const deltaReasoning: string | undefined = choice.delta?.reasoning;
                            const deltaContent: string | undefined = choice.delta?.content;
                            const hasReasoning = typeof deltaReasoning === "string" && deltaReasoning.length > 0;
                            const hasContent = typeof deltaContent === "string" && deltaContent.length > 0;

                            if (hasReasoning && !hasContent) {
                                // Pure reasoning chunk → inject into delta.content
                                const prefix = reasoningOpen ? "" : openTag;
                                choice.delta.content = prefix + deltaReasoning;
                                delete choice.delta.reasoning;
                                delete choice.delta.reasoning_details;
                                reasoningOpen = true;
                                outLines.push(`data: ${JSON.stringify(chunk)}`);

                            } else if (hasReasoning && hasContent) {
                                // Transition chunk: reasoning ends, content starts
                                // Emit reasoning part (close tag) as a separate chunk first
                                const pre = { ...chunk, choices: [{ ...choice, delta: { content: (reasoningOpen ? "" : openTag) + deltaReasoning + closeTag } }] };
                                outLines.push(`data: ${JSON.stringify(pre)}`);
                                // Then emit content part normally
                                choice.delta.content = deltaContent;
                                delete choice.delta.reasoning;
                                delete choice.delta.reasoning_details;
                                reasoningOpen = false;
                                outLines.push(`data: ${JSON.stringify(chunk)}`);

                            } else if (!hasReasoning && hasContent && reasoningOpen) {
                                // First content-only chunk after reasoning — close the block
                                const closingChunk = { ...chunk, choices: [{ ...choice, delta: { content: closeTag } }] };
                                outLines.push(`data: ${JSON.stringify(closingChunk)}`);
                                reasoningOpen = false;
                                delete choice.delta.reasoning;
                                delete choice.delta.reasoning_details;
                                outLines.push(`data: ${JSON.stringify(chunk)}`);

                            } else {
                                // No reasoning involved, pass through
                                delete choice.delta?.reasoning;
                                delete choice.delta?.reasoning_details;
                                outLines.push(`data: ${JSON.stringify(chunk)}`);
                            }
                        }

                        controller.enqueue(new TextEncoder().encode(outLines.join("\n\n") + "\n\n"));
                    }
                },
                cancel() { reader.cancel(); },
            });

            return new Response(stream, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        }

        // Unknown content type — pass through unchanged
        return response;
    };
}
