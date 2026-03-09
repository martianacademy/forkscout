// src/agent/system-prompts/identity.ts — Base system prompt: agent identity, autonomy, tools, trust tagging.
// Base identity prompt — who the agent is and how it operates.
// Loaded by agent/index.ts as the system prompt.

import type { AppConfig } from "@/config.ts";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export interface IdentityContext {
    channel?: string;
    sessionKey?: string;
    model: string;
    mcpServers: string[];
    toolCount: number;
    allToolCount?: number;
    skills: string[] | { name: string; description?: string }[];
}

// Per-channel/session cache to avoid rebuilding identical prompts repeatedly.
// Keyed by the full config+context JSON so each channel/session gets its own entry
// without evicting others (fixes single-entry thrash in multi-channel deployments).
const _cache = new Map<string, string>();

export function buildIdentity(config: AppConfig, ctx?: IdentityContext): string {
    const key = JSON.stringify({ config, ctx });
    if (_cache.has(key)) return _cache.get(key)!;

    const { name, github } = config.agent;
    const { provider, tier, providers, maxSteps, maxTokens } = config.llm;
    const modelId = providers[provider]?.[tier] ?? "unknown";
    const channel = ctx?.channel ?? "unknown";
    const sessionKey = ctx?.sessionKey ? ` | Session: ${ctx.sessionKey}` : "";
    const toolCount = ctx?.toolCount ?? 0;
    const allToolCount = ctx?.allToolCount;
    const toolLabel = allToolCount && allToolCount > toolCount
        ? `${toolCount} bootstrap / ${allToolCount} total`
        : `${toolCount}`;
    const mcpServers = ctx?.mcpServers ?? [];

    // Load the static prompt template
    const base = readFileSync(join(__dirname, "basePrompt.md"), "utf8");

    // Load extension metadata (first line of each file) and concatenate them
    const extDir = join(__dirname, "extensions");
    let extensionsMeta = "";
    try {

        const extFiles = readdirSync(extDir).filter(f => f.endsWith(".md") || f.endsWith(".txt"));
        for (const f of extFiles) {
            const content = readFileSync(join(extDir, f), "utf8");
            const firstLine = content.split("\n")[0].trim();
            if (firstLine.startsWith("{{metadata}}")) {
                extensionsMeta += firstLine + "\n";
            }
        }
    } catch (e) {
        // If the extensions folder is missing, ignore – the base prompt will be used alone.
    }

    const fullBase = extensionsMeta + base
    const prompt = fullBase
        .replace("{{AGENT_NAME}}", name)
        .replace("{{CHANNEL}}", channel)
        .replace("{{SESSION_KEY}}", sessionKey)
        .replace("{{PROVIDER}}", provider)
        .replace("{{MODEL_ID}}", modelId)
        .replace("{{TIER}}", tier)
        .replace("{{MAX_STEPS}}", String(maxSteps))
        .replace("{{MAX_TOKENS}}", String(maxTokens))
        .replace("{{TOOL_LABEL}}", toolLabel)
        .replace("{{MCP_SERVERS}}", mcpServers.length ? ` | MCP: ${mcpServers.join(", ")}` : "")
        .replace("{{GITHUB}}", github)
        .replace("{{EXTENDED_TOOLS}}",
            allToolCount && allToolCount > toolCount
                ? `Extended tools: ${allToolCount - toolCount} extra tools exist in .agents/tools/ but are not active by default. Use \`find_tools(\"what you want to do\")\` to locate them.`
                : "All discovered tools are active."
        )
        .trimStart();

    _cache.set(key, prompt);
    return prompt;
}
