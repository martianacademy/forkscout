// src/agent/system-prompts/select-extensions.ts — Select task-relevant prompt modules to inject automatically.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "@/config.ts";

const EXTENSIONS_DIR = resolve(import.meta.dir, "extensions");

type Role = "owner" | "admin" | "user" | "self" | undefined;

interface Rule {
    files: string[];
    pattern: RegExp;
}

const RULES: Rule[] = [
    {
        files: ["file-editing.md", "error-repair.md", "tool-error-recovery.md", "anti-patterns.md"],
        pattern: /\b(edit|modify|change|implement|refactor|rename|patch|fix|bug|debug|error|typecheck|compile|broken|issue)\b/i,
    },
    {
        files: ["memory.md", "cognitive-enhancements.md"],
        pattern: /\b(memory|remember|recall|knowledge|fact|history|context|learn|preference)\b/i,
    },
    {
        files: ["task-orchestration.md", "state-persistence.md"],
        pattern: /\b(worker|batch|parallel|chain|orchestrat|background|resume|continue later|long-running|self-session)\b/i,
    },
    {
        files: ["security-and-trust.md"],
        pattern: /\b(secret|vault|token|api key|credential|auth|permission|owner|admin|user role|trust|security)\b/i,
    },
    {
        files: ["performance-optimization.md"],
        pattern: /\b(token|latency|performance|slow|optimi[sz]e|budget|rate limit|context window)\b/i,
    },
    {
        files: ["role-definition.md", "cognitive-enhancements.md"],
        pattern: /\b(prompt|behavior|autonom|self-improv|self-improve|self-modif|system prompt)\b/i,
    },
];

const ORDER = [
    "file-editing.md",
    "error-repair.md",
    "tool-error-recovery.md",
    "memory.md",
    "memory-instructions.md",
    "task-orchestration.md",
    "security-and-trust.md",
    "state-persistence.md",
    "performance-optimization.md",
    "anti-patterns.md",
    "cognitive-enhancements.md",
    "role-definition.md",
];

export function buildRelevantExtensionsBlock(userMessage: string, role: Role): string {
    const selected = new Set<string>();
    const text = userMessage.trim();

    // Always inject anti-patterns — hallucination/narration rules apply to every message type.
    selected.add("anti-patterns.md");

    // Inject memory instructions when memory is enabled in config
    const config = getConfig();
    if (config.memory?.enabled) selected.add("memory-instructions.md");

    for (const rule of RULES) {
        if (rule.pattern.test(text)) {
            for (const file of rule.files) selected.add(file);
        }
    }

    if ((role === "admin" || role === "user") && text) selected.add("security-and-trust.md");
    if (selected.size === 0) return "";

    const blocks = ORDER
        .filter((file) => selected.has(file))
        .map(loadExtension)
        .filter(Boolean);

    if (blocks.length === 0) return "";

    return [
        "## Relevant Operating Modules (auto-injected for this task)",
        ...blocks,
    ].join("\n\n");
}

function loadExtension(file: string): string {
    const fullPath = resolve(EXTENSIONS_DIR, file);
    if (!existsSync(fullPath)) return "";
    const content = readFileSync(fullPath, "utf-8").trim();
    return content ? `### ${file}\n${content}` : "";
}