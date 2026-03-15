// src/agent/build-params.ts — Assemble model, tools, and system prompt for a run
import { wrapLanguageModel, extractReasoningMiddleware } from "ai";
import type { SystemModelMessage } from "ai";
import { guardrailsMiddleware, xmlToolCallMiddleware } from "@/agent/llm-middleware.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig } from "@/config.ts";
import { getProvider } from "@/providers/index.ts";
import { discoverTools } from "@/tools/auto_discover_tools.ts";
import { discoverMcpTools } from "@/mcp-servers/auto_discover_mcp.ts";
import { buildIdentity, type IdentityContext } from "@/agent/system-prompts/identity.ts";
import { buildRelevantExtensionsBlock } from "@/agent/system-prompts/select-extensions.ts";
import { buildProjectContext, isProjectRelated } from "@/agent/system-prompts/build-project-context.ts";
import { getSkills } from "@/skills/auto_discover_skills.ts";
import { sanitizeForPrompt } from "@/utils/sanitize-messages.ts";
import { sanitizeUserMessage } from "@/utils/secrets.ts";
import { stripMedia } from "@/utils/sanitize-messages.ts";
import { listAliases } from "@/secrets/vault.ts";
import {
    wrapToolsWithSecretHandling,
    wrapToolsWithErrorSafetyNet,
} from "@/agent/tool-wrappers.ts";
import { memoryTools } from "@/tools/memory_tools.ts";
import { load_skill_tools } from "@/tools/load_skill_tools.ts";
import type { AgentRunOptions } from "@/agent/types.ts";
import type { ModelMessage } from "ai";

const EXTENSIONS_DIR = resolve(import.meta.dir, "system-prompts/extensions");

export type SystemMsg = SystemModelMessage | SystemModelMessage[];

/**
 * Build a structured system message (or array of messages) for the LLM.
 * When the provider is Anthropic, the stable baseIdentity block gets
 * `cache_control: { type: "ephemeral" }` — this tells Claude to cache that
 * block across repeated calls, saving ~70 % of prompt-token cost.
 * All other providers (OpenRouter, LMStudio, etc.) receive plain text blocks;
 * they silently ignore the providerOptions since the AI SDK strips it before
 * the HTTP call.
 */
function buildSystemMessage(
    provider: string,
    baseIdentity: string,
    dynamicPrompt: string,
): SystemMsg {
    const isAnthropic = provider === "anthropic";
    const stableMsg: SystemModelMessage = {
        role: "system",
        content: baseIdentity,
        ...(isAnthropic
            ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
            : {}),
    };
    if (!dynamicPrompt) return stableMsg;
    return [stableMsg, { role: "system", content: dynamicPrompt }];
}

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
    // Bootstrap tools only — injected at every step (src/tools/ + MCP bootstrap + memory if enabled).
    // Extended tools (.agents/tools/) are available but not pre-loaded — agent calls project_sourcemap_tools to find them.
    const memTools = config.memory?.enabled ? memoryTools : {};
    const skillTools = skills.length > 0 ? { load_skill_tools } : {};
    const rawTools = Object.fromEntries(
        Object.entries({ ...bootstrapTools, ...bootstrapMcpTools, ...memTools, ...skillTools }).filter(([k]) => !excluded.has(k))
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
        projectRoot: process.cwd(),
    };

    let model: typeof baseModel = baseModel;

    // Build middleware stack — outermost first, innermost last:
    //   guardrails → reasoning (optional) → xmlToolCallParser (innermost, closest to model)
    //
    // xmlToolCallMiddleware: converts <invoke>…</invoke> XML text → proper tool-call stream parts.
    //   Handles MiniMax, some Qwen/Hermes variants that emit tool calls as raw XML text.
    // extractReasoningMiddleware: strips <think>…</think> from text so downstream never sees them.
    // guardrailsMiddleware: censors known secret values from all final LLM text output.
    const reasoningTag = config.llm.reasoningTag?.trim();
    const middlewares: import("@ai-sdk/provider").LanguageModelV3Middleware[] = [
        guardrailsMiddleware,
        ...(reasoningTag ? [extractReasoningMiddleware({ tagName: reasoningTag })] : []),
        xmlToolCallMiddleware,  // innermost — runs first, closest to raw model output
    ];
    model = wrapLanguageModel({
        model: baseModel as import("@ai-sdk/provider").LanguageModelV3,
        middleware: middlewares,
    }) as typeof model;

    // Dev-only: wrap with AI SDK DevTools middleware when DEVTOOLS=1
    const devtoolsEnabled = process.env.DEVTOOLS === "1";
    if (devtoolsEnabled) {
        const { devToolsMiddleware } = await import("@ai-sdk/devtools");
        model = wrapLanguageModel({
            model: model as import("@ai-sdk/provider").LanguageModelV3,
            middleware: devToolsMiddleware(),
        }) as typeof baseModel;
    }

    const relevantExtensions = buildRelevantExtensionsBlock(options.userMessage, options.role);
    const baseIdentity = buildIdentity(config, ctx);
    const roleExtension = options.role ? loadRoleExtension(options.role) : "";
    // projectContext: live git state + channels + version — only for project/code tasks.
    // Skipped entirely for general queries (news, math, chat) to save tokens.
    const projectContext = isProjectRelated(options.userMessage)
        ? buildProjectContext(config, options.meta?.sessionKey)
        : "";
    // currentTime injected into dynamicPrompt (NOT baseIdentity) so the stable block stays
    // byte-for-byte identical across same-session calls → Anthropic cache_control hits every time.
    const currentTime = new Date().toLocaleString("en-US", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
    });
    // vaultAliases: live list of stored secret aliases — always fresh, never cached.
    // Injected here (not in baseIdentity) so vault add/remove is reflected instantly.
    const vaultAliases = (() => {
        const aliases = listAliases();
        if (aliases.length === 0) return "Vault: empty — no secrets stored yet.";
        return `Vault aliases (${aliases.length}): ${aliases.map(a => `\`{{secret:${a}}}\``).join(", ")}`;
    })();
    // skillsBlock: minimal hint — full details loaded on demand via load_skill_tools.
    const skillsBlock = skills.length > 0
        ? `${skills.length} skill(s) installed. Use \`load_skill_tools({ action: "search", query: "..." })\` to find relevant ones.`
        : "";
    // dynamicPrompt = everything that changes per-request (time, extensions, role, vault, skills, extra).
    // Kept separate from baseIdentity so cache_control is only placed on the stable block.
    const dynamicPrompt = [
        `Time: ${currentTime}`,
        vaultAliases,
        skillsBlock,
        projectContext,
        config.agent.systemPromptExtra?.trim(),
        relevantExtensions,
        roleExtension ? `---\n\n## Active Role Instructions\n\n${roleExtension}` : "",
    ].filter(Boolean).join("\n\n");

    // Structured: Anthropic gets cache_control on the stable block; others get plain text.
    const systemMessage = buildSystemMessage(provider, baseIdentity, dynamicPrompt);
    // Flat string kept only for FAKE_LLM logging and context-retry minimal-prompt fallback.
    const systemPrompt = [baseIdentity, dynamicPrompt].filter(Boolean).join("\n\n");

    // History + current user message as the last turn.
    // AI SDK v6: `messages` and `prompt` are mutually exclusive — current input must
    // be the final entry in `messages`, not a separate `prompt` field.
    const messages: ModelMessage[] = [
        ...stripMedia(sanitizeForPrompt(options.chatHistory ?? [])),
        { role: "user", content: sanitizeUserMessage(options.userMessage) },
    ];

    return { tools, bootstrapTools, model, systemMessage, systemPrompt, messages, devtoolsEnabled };
}
