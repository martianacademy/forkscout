"use client";

import { useState, useCallback, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessages, type ChatMsg } from "@/components/web/chat-messages";
import { ChatInput } from "@/components/web/chat-input";
import { apiFetch, getToken, getApiUrl } from "@/lib/api-client";

export default function ChatPage() {
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [streaming, setStreaming] = useState(false);

    // Load history on mount
    useEffect(() => {
        apiFetch<{ messages?: { role: string; content: string }[] }>("/v1/history")
            .then((data) => {
                if (data.messages?.length) {
                    setMessages(data.messages.filter(m => m.role === "user" || m.role === "assistant")
                        .map(m => ({ role: m.role as "user" | "assistant", content: m.content })));
                }
            }).catch(() => { /* ignore — empty history */ });
    }, []);

    const clearHistory = async () => {
        try {
            await apiFetch("/v1/history", { method: "DELETE" });
            setMessages([]);
        } catch { /* ignore */ }
    };

    const sendMessage = useCallback(async (text: string) => {
        const userMsg: ChatMsg = { role: "user", content: text, timestamp: Date.now() };
        setMessages((prev) => [...prev, userMsg]);
        setStreaming(true);

        try {
            const token = getToken();
            const base = getApiUrl();
            const res = await fetch(`${base}/v1/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    messages: [{ role: "user", content: text }],
                    stream: true,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: { message?: string } | string };
                const msg = typeof err.error === "object" ? err.error?.message : err.error;
                setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg || res.statusText}` }]);
                setStreaming(false);
                return;
            }

            // Handle streaming SSE response
            const reader = res.body?.getReader();
            if (!reader) {
                const data = await res.json() as { choices?: { message?: { content?: string } }[] };
                const reply = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
                setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
                setStreaming(false);
                return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let assistantContent = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data: ")) continue;
                    const payload = trimmed.slice(6);
                    if (payload === "[DONE]") continue;
                    try {
                        const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (typeof delta === "string") {
                            assistantContent += delta;
                            setMessages((prev) => {
                                const copy = [...prev];
                                const last = copy[copy.length - 1];
                                if (last?.role === "assistant" && last.timestamp === -1) {
                                    copy[copy.length - 1] = { ...last, content: assistantContent };
                                } else {
                                    copy.push({ role: "assistant", content: assistantContent, timestamp: -1 });
                                }
                                return copy;
                            });
                        }
                    } catch { /* skip malformed */ }
                }
            }

            // Finalize — remove streaming marker
            setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.timestamp === -1) copy[copy.length - 1] = { ...last, timestamp: Date.now() };
                return copy;
            });
        } catch (e: unknown) {
            setMessages((prev) => [...prev, {
                role: "assistant", content: `Connection error: ${e instanceof Error ? e.message : "Failed to reach agent"}`,
            }]);
        }
        setStreaming(false);
    }, []);

    return (
        <div className="flex h-[calc(100vh-8rem)] flex-col -m-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">Chat</h1>
                    <p className="text-xs text-muted-foreground">Talk to your agent — full tool access</p>
                </div>
                <Button variant="ghost" size="sm" onClick={clearHistory}
                    className="gap-1.5 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Clear
                </Button>
            </div>

            <ChatMessages messages={messages} isStreaming={streaming} />
            <ChatInput onSend={sendMessage} disabled={streaming} />
        </div>
    );
}
