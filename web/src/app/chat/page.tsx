"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Navbar from "@web/components/navbar";
import MarkdownContent from "@web/components/markdown";
import { parseAgentContent, AgentStatusPill } from "@web/components/agent-status";
import {
    Send,
    Bot,
    User,
    AlertCircle,
    ShieldAlert,
    Square,
    RotateCcw,
    Sparkles,
    Trash2,
} from "lucide-react";
import { useAuth } from "@web/lib/auth-context";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

/* ── Constants ────────────────────────────────────────────────────────── */

const CHAT_ID = "forkscout-web";

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Extract plain text from message parts */
function textFromParts(parts: { type: string; text?: string }[]): string {
    return parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
}

/** Convert server {role, content}[] to UIMessage[] for setMessages */
let _msgIdCounter = 0;
function toUIMessages(
    serverMessages: { role: string; content: string }[],
): UIMessage[] {
    return serverMessages.map((m) => ({
        id: `hist-${++_msgIdCounter}`,
        role: m.role as "user" | "assistant",
        parts: [{ type: "text" as const, text: m.content }],
    }));
}

/* ── Suggestion chips for empty state ─────────────────────────────────── */

const SUGGESTIONS = [
    "What can you do?",
    "Search the web for latest AI news",
    "Read my project's README.md",
    "Run ls -la in the shell",
];

/* ── Assistant message with parsed status blocks ──────────────────────── */

function AssistantMessage({ text }: { text: string }) {
    const { segments } = parseAgentContent(text);

    return (
        <div>
            {segments.map((seg, i) =>
                typeof seg === "string" ? (
                    <MarkdownContent key={i} content={seg} />
                ) : (
                    <AgentStatusPill key={i} block={seg} />
                ),
            )}
        </div>
    );
}

/* ── Component ────────────────────────────────────────────────────────── */

export default function ChatPage() {
    const { token, isAuthenticated } = useAuth();
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    /* ── Transport ─────────────────────────────────────────────────────── */

    const transport = useMemo(
        () =>
            new DefaultChatTransport({
                api: "/api/chat",
                headers: { "X-Agent-Token": token },
            }),
        [token],
    );

    const { messages, sendMessage, status, stop, error, regenerate, setMessages } = useChat({
        id: CHAT_ID,
        transport,
        experimental_throttle: 50,
    });

    const isActive = status === "streaming" || status === "submitted";

    /* ── Load history from server on mount ─────────────────────────────── */

    const historyLoaded = useRef(false);

    useEffect(() => {
        if (historyLoaded.current || !token) return;
        historyLoaded.current = true;

        fetch("/api/history", { headers: { "X-Agent-Token": token } })
            .then((r) => r.json())
            .then((data) => {
                if (data.messages?.length && messages.length === 0) {
                    setMessages(toUIMessages(data.messages));
                }
            })
            .catch(() => { /* ignore — fresh chat on error */ });
    }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

    const clearChat = useCallback(() => {
        setMessages([]);
        // Also clear server-side history
        fetch("/api/history", {
            method: "DELETE",
            headers: { "X-Agent-Token": token },
        }).catch(() => { /* ignore */ });
    }, [setMessages, token]);

    /* ── Auto-scroll ───────────────────────────────────────────────────── */

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, status]);

    /* ── Auto-resize textarea ──────────────────────────────────────────── */

    const resizeTextarea = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }, []);

    useEffect(resizeTextarea, [input, resizeTextarea]);

    /* ── Focus management ──────────────────────────────────────────────── */

    useEffect(() => {
        if (status === "ready") textareaRef.current?.focus();
    }, [status]);

    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    /* ── Submission ────────────────────────────────────────────────────── */

    const submit = useCallback(
        (text?: string) => {
            const msg = (text ?? input).trim();
            if (!msg || isActive) return;
            setInput("");
            sendMessage({ text: msg });
        },
        [input, isActive, sendMessage],
    );

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    /* ── Auth gate ─────────────────────────────────────────────────────── */

    if (!isAuthenticated) {
        return (
            <>
                <Navbar />
                <div className="flex h-screen items-center justify-center pt-16">
                    <div className="text-center">
                        <ShieldAlert className="mx-auto mb-4 h-16 w-16 text-destructive/50" />
                        <h2 className="mb-2 text-xl font-semibold">Unauthorized</h2>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            Open the authenticated URL from{" "}
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                                forkscout web
                            </code>{" "}
                            to access the chat.
                        </p>
                    </div>
                </div>
            </>
        );
    }

    /* ── Render ────────────────────────────────────────────────────────── */

    const hasMessages = messages.length > 0;

    return (
        <>
            <Navbar />
            <div className="flex h-screen flex-col pt-16">
                {/* ── Messages area ────────────────────────────────────────── */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto">
                    <div className="mx-auto max-w-3xl px-4 py-6">
                        {/* Clear chat button */}
                        {hasMessages && status === "ready" && (
                            <div className="mb-4 flex justify-end">
                                <button
                                    onClick={clearChat}
                                    className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-500 transition-colors hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-400"
                                    title="Clear chat history"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    New chat
                                </button>
                            </div>
                        )}
                        {/* Empty state */}
                        {!hasMessages && (
                            <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
                                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 ring-1 ring-accent/20">
                                    <Sparkles className="h-8 w-8 text-accent" />
                                </div>
                                <h2 className="mb-2 text-2xl font-semibold tracking-tight">
                                    How can I help?
                                </h2>
                                <p className="mb-8 max-w-md text-center text-sm text-muted-foreground">
                                    I have tools for shell commands, web browsing, file operations,
                                    code execution, and more.
                                </p>
                                <div className="flex flex-wrap justify-center gap-2">
                                    {SUGGESTIONS.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => submit(s)}
                                            className="rounded-full border border-border bg-card px-4 py-2 text-xs text-muted-foreground transition-all hover:border-accent/40 hover:bg-accent/5 hover:text-foreground"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Messages */}
                        {messages.map((msg, i) => {
                            const isUser = msg.role === "user";
                            const text = textFromParts(
                                msg.parts as { type: string; text?: string }[],
                            );
                            const isLast = i === messages.length - 1;
                            const isLastAssistant = !isUser && isLast;

                            return (
                                <div
                                    key={msg.id}
                                    className={`group mb-6 animate-slide-up flex ${isUser ? "justify-end" : "justify-start"}`}
                                >
                                    <div className={`${isUser ? "max-w-[80%]" : "max-w-full w-full"}`}>
                                        {/* Role label + avatar */}
                                        <div className={`mb-2 flex items-center gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
                                            {isUser ? (
                                                <>
                                                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/20">
                                                        <User className="h-3.5 w-3.5 text-accent" />
                                                    </div>
                                                    <span className="text-xs font-medium text-zinc-400">
                                                        You
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15">
                                                        <Bot className="h-3.5 w-3.5 text-accent" />
                                                    </div>
                                                    <span className="text-xs font-medium text-accent/80">
                                                        ForkScout
                                                    </span>
                                                </>
                                            )}
                                        </div>

                                        {/* Message body */}
                                        <div className={isUser ? "text-right" : "pl-8"}>
                                            {isUser ? (
                                                <div className="inline-block rounded-2xl rounded-tr-sm bg-accent/15 px-4 py-2.5">
                                                    <p className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap text-left">
                                                        {text}
                                                    </p>
                                                </div>
                                            ) : (
                                                <AssistantMessage text={text} />
                                            )}

                                            {/* Actions row for assistant messages */}
                                            {isLastAssistant && status === "ready" && (
                                                <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                    <button
                                                        onClick={() => regenerate()}
                                                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                                                        title="Regenerate response"
                                                    >
                                                        <RotateCcw className="h-3 w-3" />
                                                        Regenerate
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Thinking indicator */}
                        {status === "submitted" && (
                            <div className="mb-6 animate-slide-up">
                                <div className="mb-2 flex items-center gap-2">
                                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15">
                                        <Bot className="h-3.5 w-3.5 text-accent" />
                                    </div>
                                    <span className="text-xs font-medium text-accent/80">
                                        ForkScout
                                    </span>
                                </div>
                                <div className="pl-8">
                                    <div className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800/60 px-3 py-2">
                                        <div className="h-1.5 w-1.5 rounded-full bg-accent typing-dot" />
                                        <div className="h-1.5 w-1.5 rounded-full bg-accent typing-dot" />
                                        <div className="h-1.5 w-1.5 rounded-full bg-accent typing-dot" />
                                        <span className="ml-1 text-xs text-zinc-500">Thinking…</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Error banner ─────────────────────────────────────────── */}
                {error && (
                    <div className="border-t border-red-500/10 bg-red-500/5 px-4 py-2.5">
                        <div className="mx-auto flex max-w-3xl items-center gap-2 text-sm text-red-400">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span className="truncate">{error.message}</span>
                        </div>
                    </div>
                )}

                {/* ── Input area ───────────────────────────────────────────── */}
                <div className="border-t border-border/50 bg-background/90 backdrop-blur-xl">
                    <div className="mx-auto max-w-3xl px-4 py-3">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                submit();
                            }}
                            className="relative flex items-end gap-2 rounded-2xl border border-border/80 bg-zinc-900/80 px-3 py-2 shadow-lg shadow-black/10 transition-colors focus-within:border-accent/40 focus-within:shadow-accent/5"
                        >
                            <textarea
                                ref={textareaRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Message ForkScout…"
                                rows={1}
                                className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed text-foreground placeholder-zinc-500 outline-none"
                                disabled={isActive}
                            />

                            {isActive ? (
                                <button
                                    type="button"
                                    onClick={() => stop()}
                                    className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-700/60 text-zinc-300 transition-all hover:bg-zinc-600"
                                    title="Stop generating"
                                >
                                    <Square className="h-3 w-3 fill-current" />
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!input.trim()}
                                    className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-all hover:brightness-110 disabled:opacity-30 disabled:cursor-default"
                                >
                                    <Send className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </form>
                        <p className="mt-2 text-center text-[11px] text-zinc-600">
                            ForkScout can make mistakes. Verify important information.
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}
