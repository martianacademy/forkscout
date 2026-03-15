// src/memory/store.ts — Local file-backed memory store for ForkScout
// Replaces the external MCP memory server with zero-dependency local storage.
// Data persisted as JSON files in .agents/memory/

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "@/logs/logger.ts";

const logger = log("memory:store");

const ROOT = resolve(process.cwd(), ".agents", "memory");
const CONTEXT_DIR = resolve(ROOT, "context");
const OBS_FILE = resolve(ROOT, "observations.json");
const ENTITIES_FILE = resolve(ROOT, "entities.json");

// ── Ensure directories exist ─────────────────────────────────────────────────

function ensureDirs(): void {
    if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
    if (!existsSync(CONTEXT_DIR)) mkdirSync(CONTEXT_DIR, { recursive: true });
}

// ── Generic JSON helpers ─────────────────────────────────────────────────────

function readJSON<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    try { return JSON.parse(readFileSync(path, "utf-8")) as T; }
    catch { return fallback; }
}

function writeJSON(path: string, data: unknown): void {
    ensureDirs();
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContextEntry {
    content: string;
    eventType: string;
    createdAt: string;
}

export interface Observation {
    user: string;
    assistant: string;
    createdAt: string;
}

export interface MemoryEntity {
    name: string;
    type: string;
    content: string;
    createdAt: string;
}

// ── Context (per-session working memory) ─────────────────────────────────────

export function getContext(sessionId: string): ContextEntry[] {
    const file = resolve(CONTEXT_DIR, `${sanitizeFilename(sessionId)}.json`);
    return readJSON<ContextEntry[]>(file, []);
}

export function pushContext(sessionId: string, content: string, eventType: string): void {
    const file = resolve(CONTEXT_DIR, `${sanitizeFilename(sessionId)}.json`);
    const entries = readJSON<ContextEntry[]>(file, []);
    entries.push({ content, eventType, createdAt: new Date().toISOString() });
    writeJSON(file, entries);
}

export function listSessions(): string[] {
    ensureDirs();
    return readdirSync(CONTEXT_DIR)
        .filter(f => f.endsWith(".json"))
        .map(f => f.replace(".json", ""));
}

// ── Observations (user-assistant exchange pairs) ─────────────────────────────

export function observe(user: string, assistant: string): void {
    const observations = readJSON<Observation[]>(OBS_FILE, []);
    observations.push({ user, assistant, createdAt: new Date().toISOString() });
    writeJSON(OBS_FILE, observations);
}

export function getObservations(): Observation[] {
    return readJSON<Observation[]>(OBS_FILE, []);
}

// ── Entities (named facts) ───────────────────────────────────────────────────

export function remember(name: string, type: string, content: string): void {
    const entities = readJSON<MemoryEntity[]>(ENTITIES_FILE, []);
    // Upsert: replace existing entity with same name, or append
    const idx = entities.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
    const entry: MemoryEntity = { name, type, content, createdAt: new Date().toISOString() };
    if (idx >= 0) entities[idx] = entry;
    else entities.push(entry);
    writeJSON(ENTITIES_FILE, entities);
}

export function getEntities(): MemoryEntity[] {
    return readJSON<MemoryEntity[]>(ENTITIES_FILE, []);
}

// ── Recall (keyword search across all memory) ────────────────────────────────

export interface RecallResult {
    source: "observation" | "entity" | "context";
    content: string;
    relevance: number;
    createdAt: string;
}

export function recall(query: string, maxResults = 10): RecallResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    const results: RecallResult[] = [];

    // Search observations
    for (const obs of getObservations()) {
        const text = `${obs.user} ${obs.assistant}`.toLowerCase();
        const hits = terms.filter(t => text.includes(t)).length;
        if (hits > 0) {
            results.push({
                source: "observation",
                content: `User: ${obs.user}\nAssistant: ${obs.assistant}`,
                relevance: hits / terms.length,
                createdAt: obs.createdAt,
            });
        }
    }

    // Search entities
    for (const ent of getEntities()) {
        const text = `${ent.name} ${ent.type} ${ent.content}`.toLowerCase();
        const hits = terms.filter(t => text.includes(t)).length;
        if (hits > 0) {
            results.push({
                source: "entity",
                content: `${ent.name} (${ent.type}): ${ent.content}`,
                relevance: hits / terms.length,
                createdAt: ent.createdAt,
            });
        }
    }

    // Search session contexts
    for (const session of listSessions()) {
        for (const entry of getContext(session)) {
            const text = entry.content.toLowerCase();
            const hits = terms.filter(t => text.includes(t)).length;
            if (hits > 0) {
                results.push({
                    source: "context",
                    content: `[${session}] ${entry.content}`,
                    relevance: hits / terms.length,
                    createdAt: entry.createdAt,
                });
            }
        }
    }

    // Sort by relevance (desc), then recency (desc)
    return results
        .sort((a, b) => b.relevance - a.relevance || b.createdAt.localeCompare(a.createdAt))
        .slice(0, maxResults);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFilename(s: string): string {
    return s.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 100);
}
