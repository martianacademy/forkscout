// store/storage.ts — Typed chrome.storage.local wrapper + store implementations.
// All data is stored in chrome.storage.local (up to 10MB, no sync — private).

import type { Settings, ChatSession, Memory } from "../types";
import { SK } from "../types";

// ── Generic helpers ───────────────────────────────────────────────────────────

export async function storageGet<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T) ?? null;
}

export async function storageSet<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Settings = {
    provider: "openai",
    model: "gpt-4o-mini",
    apiKeys: {},
    customBaseURL: "",
    systemPrompt: "You are Forkscout — a helpful AI assistant running directly in the browser.",
    temperature: 0.7,
    maxTokens: 2048,
    streamingEnabled: true,
    injectPageContext: true,
    injectMemories: true,
    maxMemoriesToInject: 5,
    agentUrl: "http://localhost:3200",
    agentToken: "",
    mcpBridgeEnabled: false,
};

export async function loadSettings(): Promise<Settings> {
    const stored = await storageGet<Partial<Settings>>(SK.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(s: Settings): Promise<void> {
    await storageSet(SK.SETTINGS, s);
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function loadSessions(): Promise<ChatSession[]> {
    return (await storageGet<ChatSession[]>(SK.SESSIONS)) ?? [];
}

export async function saveSessions(sessions: ChatSession[]): Promise<void> {
    await storageSet(SK.SESSIONS, sessions);
}

export async function upsertSession(session: ChatSession): Promise<void> {
    const all = await loadSessions();
    const idx = all.findIndex(s => s.id === session.id);
    if (idx >= 0) all[idx] = session;
    else all.unshift(session);
    await saveSessions(all);
}

export async function deleteSession(id: string): Promise<void> {
    const all = await loadSessions();
    await saveSessions(all.filter(s => s.id !== id));
}

export async function loadActiveSessionId(): Promise<string | null> {
    return storageGet<string>(SK.ACTIVE_SESSION);
}

export async function saveActiveSessionId(id: string): Promise<void> {
    await storageSet(SK.ACTIVE_SESSION, id);
}

// ── Memories ─────────────────────────────────────────────────────────────────

export async function loadMemories(): Promise<Memory[]> {
    return (await storageGet<Memory[]>(SK.MEMORIES)) ?? [];
}

export async function saveMemories(memories: Memory[]): Promise<void> {
    await storageSet(SK.MEMORIES, memories);
}

export async function addMemory(content: string, source: "user" | "auto" = "user"): Promise<Memory> {
    const m: Memory = { id: crypto.randomUUID(), content: content.trim(), createdAt: Date.now(), source };
    const all = await loadMemories();
    await saveMemories([m, ...all]);
    return m;
}

export async function deleteMemory(id: string): Promise<void> {
    const all = await loadMemories();
    await saveMemories(all.filter(m => m.id !== id));
}

export async function updateMemory(id: string, content: string): Promise<void> {
    const all = await loadMemories();
    const idx = all.findIndex(m => m.id === id);
    if (idx >= 0) { all[idx] = { ...all[idx], content: content.trim() }; await saveMemories(all); }
}
