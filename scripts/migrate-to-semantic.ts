// scripts/migrate-to-semantic.ts — Migrate history.json → semantic.jsonl for all sessions
// Usage: bun scripts/migrate-to-semantic.ts

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";

const CHATS_DIR = resolve(".agents/chats");

interface RawMessage {
    role: "user" | "assistant" | "tool";
    content: unknown;
}

interface SemanticTurn {
    ts: number;
    user: string;
    assistant: string;
    tools: string[];
}

function extractText(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
        for (const part of content as any[]) {
            if (part?.type === "text" && part.text) return String(part.text).trim();
        }
    }
    return "";
}

function extractToolNames(messages: RawMessage[]): string[] {
    const tools = new Set<string>();
    for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            for (const part of msg.content as any[]) {
                if (part?.type === "tool-call" && part.toolName) tools.add(part.toolName);
            }
        }
    }
    return [...tools];
}

function groupIntoTurns(messages: RawMessage[]): SemanticTurn[] {
    const turns: SemanticTurn[] = [];
    let i = 0;

    while (i < messages.length) {
        const msg = messages[i];
        if (msg.role !== "user") { i++; continue; }

        const userText = extractText(msg.content);
        if (!userText) { i++; continue; }

        // Collect subsequent assistant + tool messages until next user
        const block: RawMessage[] = [];
        let j = i + 1;
        while (j < messages.length && messages[j].role !== "user") {
            block.push(messages[j]);
            j++;
        }

        const assistantText = block
            .filter(m => m.role === "assistant")
            .map(m => extractText(m.content))
            .filter(Boolean)
            .join("\n");

        const toolNames = extractToolNames(block);

        if (userText || assistantText) {
            turns.push({ ts: Date.now(), user: userText, assistant: assistantText, tools: toolNames });
        }

        i = j;
    }

    return turns;
}

function migrateSession(sessionKey: string): void {
    const dir = resolve(CHATS_DIR, sessionKey);
    const historyPath = resolve(dir, "history.json");
    const semanticPath = resolve(dir, "semantic.jsonl");

    if (!existsSync(historyPath)) return;

    const messages = JSON.parse(readFileSync(historyPath, "utf-8")) as RawMessage[];
    const turns = groupIntoTurns(messages);

    if (turns.length === 0) {
        console.log(`  [${sessionKey}] no turns extracted from ${messages.length} messages`);
        return;
    }

    // Assign timestamps spaced 1 minute apart so they're sortable
    const baseTs = Date.now() - turns.length * 60_000;
    for (let i = 0; i < turns.length; i++) turns[i].ts = baseTs + i * 60_000;

    const lines = turns.map(t => JSON.stringify(t)).join("\n") + "\n";
    writeFileSync(semanticPath, lines, "utf-8");
    console.log(`  [${sessionKey}] migrated ${messages.length} messages → ${turns.length} turns`);
}

const sessions = readdirSync(CHATS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

console.log(`Migrating ${sessions.length} session(s)…`);
for (const s of sessions) migrateSession(s);
console.log("Done.");
