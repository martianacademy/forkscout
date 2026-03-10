// hooks/useChat.ts — Full chat state machine with streaming, sessions, memories.

import { useState, useRef, useCallback, useEffect } from "react";
import type { Message, ChatSession, Memory, Settings, PageContext } from "../types";
import { streamChat } from "../ai/stream";
import {
    loadSessions, upsertSession, deleteSession as deleteSessionStorage,
    loadActiveSessionId, saveActiveSessionId,
    loadMemories,
} from "../store/storage";

function makeId(): string { return crypto.randomUUID(); }

function autoTitle(firstUserMsg: string): string {
    return firstUserMsg.replace(/\s+/g, " ").trim().slice(0, 50) || "New chat";
}

function buildSystemContent(settings: Settings, memories: Memory[], pageCtx?: PageContext | null): string {
    const parts: string[] = [];

    if (settings.systemPrompt?.trim()) parts.push(settings.systemPrompt.trim());

    if (settings.injectMemories && memories.length > 0) {
        const top = memories.slice(0, settings.maxMemoriesToInject);
        parts.push("## Memories\n" + top.map(m => `- ${m.content}`).join("\n"));
    }

    if (settings.injectPageContext && pageCtx?.url) {
        const sel = pageCtx.selectedText ? `\nSelected text: "${pageCtx.selectedText}"` : "";
        parts.push(`## Current page\nURL: ${pageCtx.url}\nTitle: ${pageCtx.title}${sel}`);
    }

    return parts.join("\n\n");
}

export function useChat(settings: Settings | null, pageCtx?: PageContext | null) {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ── Load sessions on mount ──────────────────────────────────────────────
    useEffect(() => {
        Promise.all([loadSessions(), loadActiveSessionId()]).then(([sess, aid]) => {
            setSessions(sess);
            if (aid && sess.find(s => s.id === aid)) {
                setActiveId(aid);
            } else if (sess.length > 0) {
                setActiveId(sess[0].id);
                saveActiveSessionId(sess[0].id);
            }
        });
    }, []);

    const activeSession = sessions.find(s => s.id === activeId) ?? null;
    const messages = activeSession?.messages ?? [];

    // ── Helpers ─────────────────────────────────────────────────────────────

    const patchSession = useCallback((id: string, patch: Partial<ChatSession>) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s));
    }, []);

    const persistSession = useCallback(async (session: ChatSession) => {
        await upsertSession(session);
    }, []);

    // ── Actions ──────────────────────────────────────────────────────────────

    const newSession = useCallback(() => {
        if (!settings) return;
        const id = makeId();
        const s: ChatSession = {
            id,
            title: "New chat",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            provider: settings.provider,
            model: settings.model,
            systemPrompt: settings.systemPrompt,
        };
        setSessions(prev => [s, ...prev]);
        setActiveId(id);
        saveActiveSessionId(id);
        upsertSession(s);
        setError(null);
    }, [settings]);

    const selectSession = useCallback((id: string) => {
        setActiveId(id);
        saveActiveSessionId(id);
        setError(null);
    }, []);

    const deleteSession = useCallback(async (id: string) => {
        await deleteSessionStorage(id);
        setSessions(prev => {
            const next = prev.filter(s => s.id !== id);
            if (activeId === id) {
                const newAid = next[0]?.id ?? null;
                setActiveId(newAid);
                if (newAid) saveActiveSessionId(newAid);
            }
            return next;
        });
    }, [activeId]);

    const send = useCallback(async (userText: string) => {
        if (!settings || isStreaming) return;

        const memories = await loadMemories();
        const systemContent = buildSystemContent(settings, memories, pageCtx);

        // Resolve or create active session
        let currentId = activeId;
        let currentSession: ChatSession;

        if (!currentId) {
            const id = makeId();
            currentSession = {
                id,
                title: autoTitle(userText),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: [],
                provider: settings.provider,
                model: settings.model,
                systemPrompt: settings.systemPrompt,
            };
            setSessions(prev => [currentSession, ...prev]);
            setActiveId(id);
            saveActiveSessionId(id);
            currentId = id;
        } else {
            currentSession = sessions.find(s => s.id === currentId)!;
            if (!currentSession) return;
        }

        const userMsg: Message = {
            id: makeId(),
            role: "user",
            content: userText,
            timestamp: Date.now(),
        };

        const assistantId = makeId();
        const assistantMsg: Message = {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
        };

        // Build title from first user message
        const isFirst = currentSession.messages.length === 0;
        const newTitle = isFirst ? autoTitle(userText) : currentSession.title;

        const updatedSess: ChatSession = {
            ...currentSession,
            title: newTitle,
            messages: [...currentSession.messages, userMsg, assistantMsg],
            updatedAt: Date.now(),
        };

        setSessions(prev => prev.map(s => s.id === currentId ? updatedSess : s));
        setIsStreaming(true);
        setError(null);

        // Build messages for API (inject system if present)
        const apiMessages: Message[] = [
            ...(systemContent ? [{ id: "sys", role: "system" as const, content: systemContent, timestamp: 0 }] : []),
            ...currentSession.messages,
            userMsg,
        ];

        abortRef.current = new AbortController();
        let fullText = "";

        try {
            for await (const chunk of streamChat(apiMessages, settings, abortRef.current.signal)) {
                if (chunk.type === "text") {
                    fullText += chunk.delta;
                    setSessions(prev => prev.map(s => {
                        if (s.id !== currentId) return s;
                        return {
                            ...s,
                            messages: s.messages.map(m =>
                                m.id === assistantId ? { ...m, content: fullText } : m
                            ),
                        };
                    }));
                }
                if (chunk.type === "error") {
                    setError(chunk.message);
                    // Mark assistant message as error
                    setSessions(prev => prev.map(s => {
                        if (s.id !== currentId) return s;
                        return {
                            ...s,
                            messages: s.messages.map(m =>
                                m.id === assistantId
                                    ? { ...m, content: `Error: ${chunk.message}`, error: true }
                                    : m
                            ),
                        };
                    }));
                }
            }
        } catch (e: unknown) {
            if (e instanceof Error && e.name !== "AbortError") {
                setError(e.message);
            }
        } finally {
            setIsStreaming(false);
            // Persist final state
            setSessions(prev => {
                const final = prev.find(s => s.id === currentId);
                if (final) persistSession(final);
                return prev;
            });
        }
    }, [settings, isStreaming, activeId, sessions, pageCtx, persistSession]);

    const stopStream = useCallback(() => {
        abortRef.current?.abort();
        setIsStreaming(false);
    }, []);

    const clearSession = useCallback(() => {
        if (!activeId) return;
        patchSession(activeId, { messages: [], title: "New chat" });
        setSessions(prev => {
            const s = prev.find(x => x.id === activeId);
            if (s) upsertSession({ ...s, messages: [], title: "New chat", updatedAt: Date.now() });
            return prev;
        });
    }, [activeId, patchSession]);

    return {
        sessions,
        activeSession,
        messages,
        isStreaming,
        error,
        newSession,
        selectSession,
        deleteSession,
        send,
        stopStream,
        clearSession,
        setError,
    };
}
