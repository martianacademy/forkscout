// src/setup/default-config.ts — Default config template generated during setup.

import { buildProviderTiers } from "@/setup/provider-tiers.ts";

export function buildDefaultConfig(opts: {
    provider: string;
    tier: string;
    agentName: string;
}): any {
    return {
        channels: {
            defaults: {
                historyTokenBudget: 12000,
                rateLimitPerMinute: 20,
                maxInputLength: 3000,
            },
            telegram: {
                pollingTimeout: 30,
                historyTokenBudget: 12000,
                allowedUserIds: [],
                rateLimitPerMinute: 20,
                maxInputLength: 2000,
                maxToolResultTokens: 3000,
                maxSentencesPerToolResult: 20,
            },
            terminal: { historyTokenBudget: 16000 },
            self: { historyTokenBudget: 12000, httpPort: 3200 },
        },
        agent: {
            name: opts.agentName,
            description: "An autonomous agent that can use tools and access the web to answer questions and perform tasks.",
            github: "https://github.com/Forkscout/forkscout",
            ownerOnlyTools: ["run_shell_commands", "write_file", "git_operations", "validate_and_restart", "secret_vault"],
        },
        browser: {
            headless: false,
            profileDir: ".agents/browser-profile",
            screenshotQuality: 50,
            chromePath: "",
        },
        browserAgent: { maxSteps: 25, maxTokens: 4096 },
        llm: {
            provider: opts.provider,
            tier: opts.tier,
            maxTokens: 2000,
            maxSteps: 100,
            reasoningTag: "think",
            llmSummarizeMaxTokens: 1200,
            toolResultAutoCompressWords: 400,
            providers: buildProviderTiers(),
        },
        skills: { dirs: [".agents/skills", "src/skills/built-in"] },
        n8n: { baseUrl: "http://localhost:5678" },
    };
}
