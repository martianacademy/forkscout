// src/agent/build-params.ts — Assemble model, tools, and system prompt for a run
import { wrapLanguageModel, extractReasoningMiddleware } from "ai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "@/config.ts";
import { getProvider } from "@/providers/index.ts";
import { discoverTools } from "@/tools/auto_discover_tools.ts";
import { discoverMcpTools } from "@/mcp-servers/auto_discover_mcp.ts";
import { buildIdentity, type IdentityContext } from "@/agent/system-prompts/identity.ts";
import { getSkills } from "@/skills/auto_discover_skills.ts";
import { sanitizeForPrompt } from "@/channels/chat-store.ts";
import { sanitizeUserMessage } from "@/utils/secrets.ts";
import { stripMedia } from "@/channels/prepare-history.ts";
import {
    wrapToolsWithSecretHandling,
    wrapToolsWithErrorSafetyNet,
} from "@/agent/tool-wrappers.ts";
import type { AgentRunOptions } from "@/agent/types.ts";
import type { ModelMessage } from "ai";

const EXTENSIONS_DIR = resolve(import.meta.dir, "system-prompts/extensions");

function loadRoleExtension(role: "owner" | "admin" | "user" | "self"): string {
    if (role === "owner" || role === "self") return "";
    const file = resolve(EXTENSIONS_DIR, `role-${role}.md`);
    try { return readFileSync(file, "utf-8").trim(); } catch { return ""; }
}

export async function buildAgentParams(config: AppConfig, options: AgentRunOptions) {
    const [{ allTools, bootstrapTools }, { allMcpTools, bootstrapMcpTools }] = await Promise.all([
        discoverTools(),
        discoverMcpTools(),
    ]);
    const skills = getSkills(config);

    const excluded = new Set(options.excludeTools ?? []);
    // Only bootstrap tools are injected into the agent by default.
    // src/tools/ are all bootstrap. MCP tools are bootstrap only if "bootstrap": true in their config.
    const rawTools = Object.fromEntries(
        Object.entries({ ...bootstrapTools, ...bootstrapMcpTools }).filter(([k]) => !excluded.has(k))
    );

    const secretSafeTools = wrapToolsWithSecretHandling(rawTools);
    const tools = wrapToolsWithErrorSafetyNet(secretSafeTools);

    const { provider, tier, providers } = config.llm;
    const modelId = providers[provider][tier];
    const baseModel = getProvider(provider).chat(modelId);

    const mcpServers = [...new Set(
        Object.keys(allMcpTools)
            .map((k) => k.split("__")[0])
            .filter(Boolean)
    )];

    const ctx: IdentityContext = {
        channel: options.meta?.channel,
        sessionKey: options.meta?.sessionKey,
        model: `${provider}/${modelId}`,
        mcpServers,
        toolCount: Object.keys(tools).length,
        allToolCount: Object.keys({ ...allTools, ...allMcpTools }).length,
        skills,
    };

    let model: typeof baseModel = baseModel;

    // Apply extractReasoningMiddleware when reasoningTag is configured.
    const reasoningTag = config.llm.reasoningTag?.trim();
    if (reasoningTag) {
        model = wrapLanguageModel({
            model: baseModel as import("@ai-sdk/provider").LanguageModelV3,
            middleware: extractReasoningMiddleware({ tagName: reasoningTag }),
        }) as typeof model;
    }

    // Dev-only: wrap with AI SDK DevTools middleware when DEVTOOLS=1
    const devtoolsEnabled = process.env.DEVTOOLS === "1";
    if (devtoolsEnabled) {
        const { devToolsMiddleware } = await import("@ai-sdk/devtools");
        model = wrapLanguageModel({
            model: model as import("@ai-sdk/provider").LanguageModelV3,
            middleware: devToolsMiddleware(),
        }) as typeof baseModel;
    }

    const basePrompt = config.agent.systemPromptExtra
        ? `${buildIdentity(config, ctx)}\n\n${config.agent.systemPromptExtra}`
        : buildIdentity(config, ctx);

    const roleExtension = options.role ? loadRoleExtension(options.role) : "";
    const systemPrompt = roleExtension
        ? `${basePrompt}\n\n---\n\n## Active Role Instructions\n\n${roleExtension}`
        : basePrompt;

    // History + current user message as the last turn.
    // AI SDK v6: `messages` and `prompt` are mutually exclusive — current input must
    // be the final entry in `messages`, not a separate `prompt` field.
    const messages: ModelMessage[] = [
        ...stripMedia(sanitizeForPrompt(options.chatHistory ?? [])),
        { role: "user", content: sanitizeUserMessage(options.userMessage) },
    ];

    return { tools, bootstrapTools, model, systemPrompt, messages, devtoolsEnabled };
}
