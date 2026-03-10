// ai/stream.ts — Universal browser-native streaming chat engine.
// Supports OpenAI-compatible (openai, groq, openrouter, mistral, deepseek, xai, ollama, lmstudio, custom),
// Anthropic, and Google Gemini formats. No Node.js deps — pure fetch + ReadableStream.

import type { Message, Settings } from "../types";
import { getProviderDef } from "./providers";

export type StreamChunk =
    | { type: "text"; delta: string }
    | { type: "done"; fullText: string }
    | { type: "error"; message: string };

// ── Public API ────────────────────────────────────────────────────────────────

export async function* streamChat(
    messages: Message[],
    settings: Settings,
    signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
    const provDef = getProviderDef(settings.provider);
    const baseURL =
        settings.provider === "custom" && settings.customBaseURL
            ? settings.customBaseURL.replace(/\/$/, "")
            : provDef.baseURL;

    const apiKey = settings.apiKeys[settings.provider] ?? "";

    // Extract system message if present; otherwise use settings.systemPrompt
    const systemMsg =
        messages.find(m => m.role === "system")?.content?.trim() ||
        settings.systemPrompt?.trim() ||
        "";
    const convo = messages.filter(m => m.role !== "system");

    if (provDef.format === "anthropic") {
        yield* streamAnthropic(baseURL, apiKey, settings, systemMsg, convo, signal);
    } else if (provDef.format === "google") {
        yield* streamGoogle(baseURL, apiKey, settings, systemMsg, convo, signal);
    } else {
        yield* streamOpenAI(baseURL, apiKey, settings, systemMsg, convo, signal);
    }
}

// ── OpenAI-compatible ─────────────────────────────────────────────────────────

async function* streamOpenAI(
    baseURL: string,
    apiKey: string,
    settings: Settings,
    systemPrompt: string,
    messages: Message[],
    signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
    const url = `${baseURL}/chat/completions`;

    const body: Record<string, unknown> = {
        model: settings.model,
        stream: settings.streamingEnabled,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
    };

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    // Ollama & LMStudio don't need auth but need the header to be absent is fine
    if (settings.provider === "openrouter") {
        headers["HTTP-Referer"] = "https://github.com/Forkscout/forkscout-window";
        headers["X-Title"] = "Forkscout Window";
    }

    let res: Response;
    try {
        res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e: unknown) {
        yield { type: "error", message: networkErr(e) };
        return;
    }

    if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        yield { type: "error", message: `${res.status}: ${err}` };
        return;
    }

    if (!settings.streamingEnabled) {
        const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content ?? "";
        yield { type: "text", delta: text };
        yield { type: "done", fullText: text };
        return;
    }

    yield* parseSseOpenAI(res, signal);
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function* streamAnthropic(
    baseURL: string,
    apiKey: string,
    settings: Settings,
    systemPrompt: string,
    messages: Message[],
    signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
    const url = `${baseURL}/messages`;

    const body: Record<string, unknown> = {
        model: settings.model,
        stream: true,
        max_tokens: settings.maxTokens,
        messages: messages.map(m => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
        })),
    };
    if (systemPrompt) body.system = systemPrompt;

    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-allow-browser": "true",
            },
            body: JSON.stringify(body),
            signal,
        });
    } catch (e: unknown) {
        yield { type: "error", message: networkErr(e) };
        return;
    }

    if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        yield { type: "error", message: `${res.status}: ${err}` };
        return;
    }

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            try {
                const evt = JSON.parse(raw) as Record<string, unknown>;
                if (evt.type === "content_block_delta") {
                    const delta = (evt.delta as Record<string, unknown>)?.text as string ?? "";
                    if (delta) { full += delta; yield { type: "text", delta }; }
                }
                if (evt.type === "message_stop") {
                    yield { type: "done", fullText: full };
                    return;
                }
            } catch { /* skip */ }
        }
    }
    yield { type: "done", fullText: full };
}

// ── Google Gemini ─────────────────────────────────────────────────────────────

async function* streamGoogle(
    baseURL: string,
    apiKey: string,
    settings: Settings,
    systemPrompt: string,
    messages: Message[],
    signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
    const url = `${baseURL}/models/${settings.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const body: Record<string, unknown> = {
        contents: messages.map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        })),
        generationConfig: {
            temperature: settings.temperature,
            maxOutputTokens: settings.maxTokens,
        },
    };
    if (systemPrompt) {
        body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    let res: Response;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal,
        });
    } catch (e: unknown) {
        yield { type: "error", message: networkErr(e) };
        return;
    }

    if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        yield { type: "error", message: `${res.status}: ${err}` };
        return;
    }

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            try {
                const evt = JSON.parse(raw) as Record<string, unknown>;
                const delta =
                    ((evt.candidates as Array<Record<string, unknown>>)?.[0]
                        ?.content as Record<string, unknown>)
                        ?.parts as Array<{ text?: string }>;
                const t = delta?.[0]?.text ?? "";
                if (t) { full += t; yield { type: "text", delta: t }; }
            } catch { /* skip */ }
        }
    }
    yield { type: "done", fullText: full };
}

// ── OpenAI SSE parser (shared) ────────────────────────────────────────────────

async function* parseSseOpenAI(res: Response, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let full = "";

    try {
        while (true) {
            if (signal?.aborted) { reader.cancel(); break; }
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const raw = line.slice(6).trim();
                if (raw === "[DONE]") { yield { type: "done", fullText: full }; return; }
                try {
                    const j = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
                    const delta = j.choices?.[0]?.delta?.content ?? "";
                    if (delta) { full += delta; yield { type: "text", delta }; }
                } catch { /* skip */ }
            }
        }
    } finally {
        reader.releaseLock();
    }
    yield { type: "done", fullText: full };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function networkErr(e: unknown): string {
    if (e instanceof Error) {
        if (e.name === "AbortError") return "Request cancelled";
        return e.message;
    }
    return String(e);
}
