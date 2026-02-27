// src/setup/wizard.ts — Interactive terminal setup wizard for ForkScout
// Run: bun run setup  OR  bun run src/index.ts --setup
//
// Uses @inquirer/prompts for interactive select, confirm, password, input.
// Secrets go ONLY into the encrypted vault. .env contains only VAULT_KEY.
// At boot, populateEnvFromVault() loads secrets into process.env.

import { select, confirm, password, input } from "@inquirer/prompts";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { setSecret, listAliases, getSecret } from "@/secrets/vault.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const ENV_FILE = resolve(ROOT, ".env");
const CONFIG_FILE = resolve(__dirname, "..", "forkscout.config.json");
const AGENTS_DIR = resolve(ROOT, ".agents");

// ── Provider metadata ────────────────────────────────────────────────────────

interface ProviderInfo {
    name: string;
    displayName: string;
    envVar: string;
    keyUrl: string;
    description: string;
}

const PROVIDERS: ProviderInfo[] = [
    { name: "openrouter", displayName: "OpenRouter", envVar: "OPENROUTER_API_KEY", keyUrl: "https://openrouter.ai/keys", description: "200+ models with one key — recommended" },
    { name: "anthropic", displayName: "Anthropic", envVar: "ANTHROPIC_API_KEY", keyUrl: "https://console.anthropic.com/settings/keys", description: "Claude models (Haiku, Sonnet, Opus)" },
    { name: "google", displayName: "Google", envVar: "GOOGLE_GENERATIVE_AI_API_KEY", keyUrl: "https://aistudio.google.com/apikey", description: "Gemini models (Flash, Pro)" },
    { name: "xai", displayName: "xAI", envVar: "XAI_API_KEY", keyUrl: "https://console.x.ai/", description: "Grok models" },
    { name: "deepseek", displayName: "DeepSeek", envVar: "DEEPSEEK_API_KEY", keyUrl: "https://platform.deepseek.com/api_keys", description: "DeepSeek Chat & Reasoner" },
    { name: "perplexity", displayName: "Perplexity", envVar: "PERPLEXITY_API_KEY", keyUrl: "https://www.perplexity.ai/settings/api", description: "Sonar models — built-in web search" },
    { name: "vercel", displayName: "Vercel", envVar: "VERCEL_API_KEY", keyUrl: "https://vercel.com/account/tokens", description: "Vercel AI Gateway (multi-provider)" },
    { name: "replicate", displayName: "Replicate", envVar: "REPLICATE_API_TOKEN", keyUrl: "https://replicate.com/account/api-tokens", description: "Open-source models (Llama, etc.)" },
    { name: "huggingface", displayName: "HuggingFace", envVar: "HUGGINGFACE_API_KEY", keyUrl: "https://huggingface.co/settings/tokens", description: "Open-source models" },
];

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const c = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    magenta: "\x1b[35m",
    red: "\x1b[31m",
    white: "\x1b[37m",
};

// ── .env file helpers ────────────────────────────────────────────────────────

function loadEnvFile(): Map<string, string> {
    const map = new Map<string, string>();
    if (!existsSync(ENV_FILE)) return map;
    const lines = readFileSync(ENV_FILE, "utf-8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        map.set(key, value);
    }
    return map;
}

function saveEnvFile(vars: Map<string, string>): void {
    const lines: string[] = [
        "# ForkScout environment — ONLY vault key lives here",
        "# All secrets are in .agents/vault.enc.json (encrypted)",
        "# Do NOT put API keys here — use 'bun run setup' instead",
        "",
    ];
    for (const [key, value] of vars) {
        const needsQuotes = /[\s#\"'$\\]/.test(value);
        lines.push(`${key}=${needsQuotes ? `"${value}"` : value}`);
    }
    lines.push("");
    writeFileSync(ENV_FILE, lines.join("\n"), "utf-8");
}

// ── VAULT_KEY generation ─────────────────────────────────────────────────────

/** Generate or load VAULT_KEY. Returns the key and whether it was newly generated. */
function ensureVaultKey(envVars: Map<string, string>): { vaultKey: string; generated: boolean } {
    // Check process.env first (may be set externally)
    const fromEnv = process.env.VAULT_KEY;
    if (fromEnv) return { vaultKey: fromEnv, generated: false };

    // Check .env file
    const fromFile = envVars.get("VAULT_KEY");
    if (fromFile) {
        process.env.VAULT_KEY = fromFile;
        return { vaultKey: fromFile, generated: false };
    }

    // Generate a new 256-bit key
    const newKey = randomBytes(32).toString("hex");
    process.env.VAULT_KEY = newKey;
    return { vaultKey: newKey, generated: true };
}

// ── Secret names (anything with KEY, TOKEN, SECRET, PASSWORD, SID, AUTH) ────

const SECRET_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|SID|AUTH/i;

function isSecretVar(name: string): boolean {
    return SECRET_PATTERN.test(name);
}

/** Migrate secrets from .env to vault. Returns count of migrated secrets. */
function migrateEnvSecretsToVault(envVars: Map<string, string>): number {
    let count = 0;
    const toRemove: string[] = [];

    for (const [key, value] of envVars) {
        if (key === "VAULT_KEY") continue; // VAULT_KEY stays in .env
        if (!isSecretVar(key)) continue;
        if (!value) continue;

        // Check if already in vault
        const existing = getSecret(key);
        if (!existing) {
            setSecret(key, value);
            count++;
        }
        toRemove.push(key);
    }

    // Remove migrated secrets from envVars (so they won't be written to .env)
    for (const key of toRemove) {
        envVars.delete(key);
    }

    return count;
}

// ── Config file helpers ──────────────────────────────────────────────────────

function loadConfigFile(): any {
    if (!existsSync(CONFIG_FILE)) return null;
    try {
        return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
        return null;
    }
}

function saveConfigFile(config: any): void {
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4) + "\n", "utf-8");
}

// ── Default config template ──────────────────────────────────────────────────

export function buildDefaultConfig(opts: {
    provider: string;
    tier: string;
    agentName: string;
}): any {
    return {
        telegram: {
            pollingTimeout: 30,
            historyTokenBudget: 12000,
            allowedUserIds: [],
            rateLimitPerMinute: 20,
            maxInputLength: 2000,
            ownerOnlyTools: ["run_shell_commands", "write_file"],
            maxToolResultTokens: 3000,
            maxSentencesPerToolResult: 20,
        },
        terminal: {
            historyTokenBudget: 12000,
        },
        self: {
            historyTokenBudget: 12000,
            httpPort: 3200,
        },
        agent: {
            name: opts.agentName,
            description: "An autonomous agent that can use tools and access the web to answer questions and perform tasks.",
            github: "https://github.com/marsnext/forkscout",
        },
        browser: {
            headless: false,
            profileDir: ".agents/browser-profile",
            screenshotQuality: 50,
            chromePath: "",
        },
        browserAgent: {
            maxSteps: 25,
            maxTokens: 4096,
        },
        llm: {
            provider: opts.provider,
            tier: opts.tier,
            maxTokens: 2000,
            maxSteps: 100,
            reasoningTag: "think",
            llmSummarizeMaxTokens: 1200,
            toolResultAutoCompressWords: 400,
            providers: {
                openrouter: {
                    fast: "google/gemini-2.0-flash-001",
                    balanced: "minimax/minimax-m2.5",
                    powerful: "anthropic/claude-sonnet-4-5",
                    vision: "google/gemini-2.0-flash-001",
                    summarizer: "google/gemini-2.0-flash-001",
                    browser: "google/gemini-2.0-flash-001",
                    transcriber: "",
                    tts: "",
                },
                anthropic: {
                    fast: "claude-haiku-4-5",
                    balanced: "claude-sonnet-4-5",
                    powerful: "claude-opus-4-5",
                    vision: "claude-sonnet-4-5",
                    summarizer: "claude-haiku-4-5",
                    browser: "claude-sonnet-4-5",
                    transcriber: "",
                    tts: "",
                },
                google: {
                    fast: "gemini-2.0-flash",
                    balanced: "gemini-2.5-pro",
                    powerful: "gemini-2.5-pro",
                    vision: "gemini-2.0-flash",
                    summarizer: "gemini-2.0-flash",
                    browser: "gemini-2.0-flash",
                    transcriber: "",
                    tts: "",
                },
                xai: {
                    fast: "grok-3-mini-fast",
                    balanced: "grok-3",
                    powerful: "grok-3",
                    vision: "grok-3",
                    summarizer: "grok-3-mini-fast",
                    browser: "grok-3",
                    transcriber: "",
                    tts: "",
                },
                vercel: {
                    fast: "openai:gpt-4o-mini",
                    balanced: "openai:gpt-4o",
                    powerful: "anthropic:claude-sonnet-4-5",
                    vision: "openai:gpt-4o",
                    summarizer: "openai:gpt-4o-mini",
                    browser: "openai:gpt-4o",
                    transcriber: "",
                    tts: "",
                },
                replicate: {
                    fast: "meta/meta-llama-3-8b-instruct",
                    balanced: "meta/meta-llama-3.1-405b-instruct",
                    powerful: "meta/meta-llama-3.1-405b-instruct",
                    vision: "",
                    summarizer: "meta/meta-llama-3-8b-instruct",
                    browser: "",
                    transcriber: "",
                    tts: "",
                },
                huggingface: {
                    fast: "meta-llama/Llama-3.2-3B-Instruct",
                    balanced: "meta-llama/Llama-3.3-70B-Instruct",
                    powerful: "meta-llama/Llama-3.3-70B-Instruct",
                    vision: "",
                    summarizer: "meta-llama/Llama-3.2-3B-Instruct",
                    browser: "",
                    transcriber: "",
                    tts: "",
                },
                deepseek: {
                    fast: "deepseek-chat",
                    balanced: "deepseek-chat",
                    powerful: "deepseek-reasoner",
                    vision: "",
                    summarizer: "deepseek-chat",
                    browser: "",
                    transcriber: "",
                    tts: "",
                },
                perplexity: {
                    fast: "sonar",
                    balanced: "sonar-pro",
                    powerful: "sonar-pro",
                    vision: "",
                    summarizer: "sonar",
                    browser: "",
                    transcriber: "",
                    tts: "",
                },
            },
        },
        skills: {
            dirs: [".agents/skills", "src/skills/built-in"],
        },
        n8n: {
            baseUrl: "http://localhost:5678",
        },
    };
}

// ── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
    console.log("");
    console.log(`${c.cyan}${c.bold}  ╔══════════════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.cyan}${c.bold}  ║                                                  ║${c.reset}`);
    console.log(`${c.cyan}${c.bold}  ║${c.reset}   ${c.magenta}${c.bold}⑂  ForkScout — Setup Wizard${c.reset}                  ${c.cyan}${c.bold}║${c.reset}`);
    console.log(`${c.cyan}${c.bold}  ║${c.reset}   ${c.dim}v3.0.0${c.reset}                                       ${c.cyan}${c.bold}║${c.reset}`);
    console.log(`${c.cyan}${c.bold}  ║                                                  ║${c.reset}`);
    console.log(`${c.cyan}${c.bold}  ╚══════════════════════════════════════════════════╝${c.reset}`);
    console.log("");
}

// ── Disclaimer ───────────────────────────────────────────────────────────────

async function showDisclaimer(): Promise<boolean> {
    console.log(`${c.yellow}${c.bold}  ⚠  IMPORTANT — Please Read Before Continuing${c.reset}`);
    console.log(`${c.yellow}  ${"─".repeat(48)}${c.reset}`);
    console.log("");
    console.log(`  ForkScout is an ${c.bold}autonomous AI agent${c.reset} that can:`);
    console.log("");
    console.log(`    ${c.bold}•${c.reset} Execute shell commands on your system`);
    console.log(`    ${c.bold}•${c.reset} Read, write, and delete files`);
    console.log(`    ${c.bold}•${c.reset} Browse the web and make HTTP requests`);
    console.log(`    ${c.bold}•${c.reset} Install packages and modify configurations`);
    console.log(`    ${c.bold}•${c.reset} Run code and interact with external services`);
    console.log("");
    console.log(`  The agent operates ${c.bold}autonomously${c.reset} based on LLM decisions.`);
    console.log(`  While safety guards exist, ${c.yellow}no AI system is infallible${c.reset}.`);
    console.log("");
    console.log(`  ${c.dim}By continuing, you acknowledge that:${c.reset}`);
    console.log(`  ${c.dim}  1. You understand the risks of running an autonomous agent${c.reset}`);
    console.log(`  ${c.dim}  2. You will review the agent's actions and tool permissions${c.reset}`);
    console.log(`  ${c.dim}  3. You accept responsibility for the agent's operations${c.reset}`);
    console.log(`  ${c.dim}  4. You will not use this software for harmful purposes${c.reset}`);
    console.log("");
    console.log(`${c.yellow}  ${"─".repeat(48)}${c.reset}`);
    console.log("");

    const accepted = await confirm({
        message: "Do you accept and wish to continue?",
        default: false,
    });
    console.log("");
    return accepted;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function printSuccess(msg: string): void {
    console.log(`  ${c.green}✓${c.reset} ${msg}`);
}

function printSkipped(msg: string): void {
    console.log(`  ${c.dim}⊘ ${msg}${c.reset}`);
}

// ── Wizard steps ─────────────────────────────────────────────────────────────

async function stepProvider(): Promise<ProviderInfo> {
    console.log(`${c.cyan}${c.bold}  Step 1/5 — LLM Provider${c.reset}`);
    console.log(`${c.cyan}  ${"━".repeat(40)}${c.reset}`);
    console.log("");

    const providerName = await select<string>({
        message: "Choose your primary LLM provider",
        choices: PROVIDERS.map((p, i) => ({
            value: p.name,
            name: `${p.displayName.padEnd(14)} ${c.dim}${p.description}${c.reset}`,
            ...(i === 0 ? { description: "← recommended" } : {}),
        })),
        default: "openrouter",
    });

    const provider = PROVIDERS.find(p => p.name === providerName)!;
    console.log("");
    return provider;
}

async function stepApiKey(provider: ProviderInfo, _envVars: Map<string, string>): Promise<void> {
    console.log(`${c.cyan}${c.bold}  Step 2/5 — API Key${c.reset}`);
    console.log(`${c.cyan}  ${"━".repeat(40)}${c.reset}`);
    console.log("");

    const vaultExisting = getSecret(provider.envVar);

    if (vaultExisting) {
        const masked = vaultExisting.slice(0, 8) + "..." + vaultExisting.slice(-4);
        console.log(`  ${c.dim}Existing key found (vault): ${masked}${c.reset}`);

        const replace = await confirm({
            message: "Replace existing key?",
            default: false,
        });

        if (!replace) {
            printSuccess(`Keeping existing ${provider.envVar}`);
            console.log("");
            return;
        }
    }

    console.log(`  Enter your ${c.bold}${provider.displayName}${c.reset} API key:`);
    console.log(`  ${c.dim}Get one at: ${provider.keyUrl}${c.reset}`);
    console.log("");

    const key = await password({
        message: provider.envVar,
        mask: "*",
    });

    if (!key) {
        console.log(`  ${c.yellow}⚠ No key entered — you'll need to set ${provider.envVar} manually${c.reset}`);
    } else {
        setSecret(provider.envVar, key);
        printSuccess(`${provider.envVar} saved to ${c.bold}encrypted vault${c.reset}`);
    }
    console.log("");
}

async function stepTier(provider: ProviderInfo): Promise<string> {
    console.log(`${c.cyan}${c.bold}  Step 3/5 — Model Tier${c.reset}`);
    console.log(`${c.cyan}  ${"━".repeat(40)}${c.reset}`);
    console.log("");

    const tmpConfig = buildDefaultConfig({ provider: provider.name, tier: "balanced", agentName: "ForkScout" });
    const tiers = tmpConfig.llm.providers[provider.name];
    if (!tiers) {
        console.log(`  ${c.yellow}⚠ No model tiers configured for ${provider.displayName}${c.reset}`);
        console.log("");
        return "balanced";
    }

    const tierOptions = [
        { key: "fast", model: tiers.fast || "—", desc: "cheapest, good for simple tasks" },
        { key: "balanced", model: tiers.balanced || "—", desc: "speed/quality balance" },
        { key: "powerful", model: tiers.powerful || "—", desc: "best reasoning" },
    ];

    const tier = await select<string>({
        message: "Choose default model quality tier",
        choices: tierOptions.map(t => ({
            value: t.key,
            name: `${t.key.padEnd(10)} ${c.dim}${t.desc}${c.reset}`,
            description: `model: ${t.model}`,
        })),
        default: "balanced",
    });

    const chosen = tierOptions.find(t => t.key === tier)!;
    printSuccess(`Tier set: ${chosen.key} (${chosen.model})`);
    console.log("");
    return tier;
}

async function stepTelegram(_envVars: Map<string, string>): Promise<void> {
    console.log(`${c.cyan}${c.bold}  Step 4/5 — Telegram Bot (optional)${c.reset}`);
    console.log(`${c.cyan}  ${"━".repeat(40)}${c.reset}`);
    console.log("");

    const vaultToken = getSecret("TELEGRAM_BOT_TOKEN");

    if (vaultToken) {
        const masked = vaultToken.slice(0, 8) + "..." + vaultToken.slice(-4);
        console.log(`  ${c.dim}Existing bot token found (vault): ${masked}${c.reset}`);

        const replace = await confirm({
            message: "Replace existing token?",
            default: false,
        });

        if (!replace) {
            printSuccess("Keeping existing Telegram bot token");
            await askTelegramOwnerId();
            console.log("");
            return;
        }
    }

    const wantTelegram = await confirm({
        message: "Set up a Telegram bot?",
        default: !!vaultToken,
    });

    if (!wantTelegram) {
        printSkipped("Telegram bot — skipped");
        console.log("");
        return;
    }

    console.log("");
    console.log(`  ${c.dim}Create a bot at: https://t.me/BotFather${c.reset}`);
    console.log("");

    const token = await password({
        message: "TELEGRAM_BOT_TOKEN",
        mask: "*",
    });

    if (!token) {
        console.log(`  ${c.yellow}⚠ No token entered — you'll need to set TELEGRAM_BOT_TOKEN manually${c.reset}`);
    } else {
        setSecret("TELEGRAM_BOT_TOKEN", token);
        printSuccess(`TELEGRAM_BOT_TOKEN saved to ${c.bold}encrypted vault${c.reset}`);
    }

    await askTelegramOwnerId();
    console.log("");
}

async function askTelegramOwnerId(): Promise<void> {
    // Load existing owner IDs from vault
    const existingRaw = getSecret("TELEGRAM_OWNER_IDS");
    let ownerUserIds: number[] = [];
    if (existingRaw) {
        try { ownerUserIds = JSON.parse(existingRaw); } catch { /* ignore */ }
    }

    if (ownerUserIds.length > 0) {
        console.log(`  ${c.dim}Owner IDs (vault): ${ownerUserIds.join(", ")}${c.reset}`);

        const replace = await confirm({
            message: "Replace existing owner IDs?",
            default: false,
        });

        if (!replace) {
            printSuccess(`Keeping owner IDs: ${ownerUserIds.join(", ")}`);
            return;
        }
        ownerUserIds = [];
    }

    console.log("");
    console.log(`  ${c.dim}Owner IDs get full access including shell commands.${c.reset}`);
    console.log(`  ${c.dim}Find your ID at: https://t.me/userinfobot${c.reset}`);

    const ownerId = await input({
        message: "Your Telegram user ID (Enter to skip)",
        default: "",
    });

    if (ownerId && !isNaN(Number(ownerId))) {
        ownerUserIds.push(Number(ownerId));
        setSecret("TELEGRAM_OWNER_IDS", JSON.stringify(ownerUserIds));
        printSuccess(`Owner ID saved to ${c.bold}encrypted vault${c.reset}: ${ownerId}`);
    }
}

async function stepAgentName(existingConfig: any | null): Promise<string> {
    console.log(`${c.cyan}${c.bold}  Step 5/5 — Agent Name (optional)${c.reset}`);
    console.log(`${c.cyan}  ${"━".repeat(40)}${c.reset}`);
    console.log("");

    const current = existingConfig?.agent?.name ?? "ForkScout";

    const name = await input({
        message: "Agent name",
        default: current,
    });

    const chosen = name || current;
    printSuccess(`Agent name: ${chosen}`);
    console.log("");
    return chosen;
}

// ── Summary ──────────────────────────────────────────────────────────────────

function printSummary(generatedConfig: any): void {
    const provider = generatedConfig.llm.provider;
    const tier = generatedConfig.llm.tier;
    const tiers = generatedConfig.llm.providers[provider];
    const model = tiers?.[tier] ?? "—";
    const providerInfo = PROVIDERS.find(p => p.name === provider);
    const hasTelegram = !!getSecret("TELEGRAM_BOT_TOKEN");
    const agentName = generatedConfig.agent.name;
    const ownerIdsRaw = getSecret("TELEGRAM_OWNER_IDS");
    let ownerIds: number[] = [];
    if (ownerIdsRaw) { try { ownerIds = JSON.parse(ownerIdsRaw); } catch { /* ignore */ } }

    console.log(`${c.green}${c.bold}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    console.log(`${c.green}${c.bold}    ✓ Setup Complete!${c.reset}`);
    console.log(`${c.green}${c.bold}  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
    console.log("");
    console.log(`  ${c.dim}Provider:${c.reset}  ${c.bold}${providerInfo?.displayName ?? provider}${c.reset}`);
    console.log(`  ${c.dim}Tier:${c.reset}      ${c.bold}${tier}${c.reset}`);
    console.log(`  ${c.dim}Model:${c.reset}     ${c.bold}${model}${c.reset}`);
    console.log(`  ${c.dim}Telegram:${c.reset}  ${hasTelegram ? `${c.green}✓ configured${c.reset}` : `${c.dim}not configured${c.reset}`}`);
    if (ownerIds.length > 0) {
        console.log(`  ${c.dim}Owner:${c.reset}     ${c.bold}${ownerIds.join(", ")}${c.reset} ${c.dim}(vault)${c.reset}`);
    }
    console.log(`  ${c.dim}Agent:${c.reset}     ${c.bold}${agentName}${c.reset}`);
    console.log("");
    console.log(`  ${c.dim}Files generated:${c.reset}`);
    console.log(`    ${c.dim}•${c.reset} ${c.bold}src/forkscout.config.json${c.reset} ${c.dim}(full config — provider, tier, models, all defaults)${c.reset}`);
    console.log(`    ${c.dim}•${c.reset} .agents/vault.enc.json ${c.dim}(${c.green}encrypted secrets${c.reset}${c.dim})${c.reset}`);
    console.log(`    ${c.dim}•${c.reset} .env ${c.dim}(VAULT_KEY only — ${c.bold}no secrets in plain text${c.reset}${c.dim})${c.reset}`);
    console.log("");
    console.log(`  ${c.cyan}${c.bold}To start:${c.reset}`);
    if (hasTelegram) {
        console.log(`    ${c.bold}bun start${c.reset}       ${c.dim}— Start Telegram bot${c.reset}`);
    }
    console.log(`    ${c.bold}bun run cli${c.reset}     ${c.dim}— Terminal chat${c.reset}`);
    console.log(`    ${c.bold}bun run dev${c.reset}     ${c.dim}— Development mode (hot reload)${c.reset}`);
    console.log(`    ${c.bold}bun run setup${c.reset}   ${c.dim}— Run this wizard again${c.reset}`);
    console.log("");
}

// ── Main wizard ──────────────────────────────────────────────────────────────

export async function runSetupWizard(): Promise<void> {
    try {
        printBanner();

        // Disclaimer — must accept before proceeding
        const accepted = await showDisclaimer();
        if (!accepted) {
            console.log(`  ${c.dim}Setup cancelled. No changes were made.${c.reset}`);
            console.log("");
            return;
        }

        // Ensure .agents directory exists (vault, browser profile, chat history, etc.)
        mkdirSync(AGENTS_DIR, { recursive: true });

        console.log(`  ${c.dim}Let's get your AI agent configured.${c.reset}`);
        console.log("");

        // Load existing .env and config
        const existingConfig = loadConfigFile();
        const envVars = loadEnvFile();

        // ── VAULT_KEY: generate or load ──────────────────────────────
        const { vaultKey, generated: vaultKeyGenerated } = ensureVaultKey(envVars);
        if (vaultKeyGenerated) {
            printSuccess(`Generated VAULT_KEY (256-bit) for secret encryption`);
        } else {
            printSuccess(`VAULT_KEY loaded`);
        }

        // ── Migrate existing .env secrets to vault ───────────────────
        const migratedCount = migrateEnvSecretsToVault(envVars);
        if (migratedCount > 0) {
            printSuccess(`Migrated ${migratedCount} secret(s) from .env → encrypted vault`);
        }

        // After migration, envVars should only have non-secret vars + VAULT_KEY
        // Clear all remaining non-VAULT_KEY vars from envVars (they stay in .env but won't be rewritten)
        const cleanEnv = new Map<string, string>();
        cleanEnv.set("VAULT_KEY", vaultKey);
        // Keep non-secret vars (URLs, domains, ports) in .env
        for (const [key, value] of envVars) {
            if (key === "VAULT_KEY") continue;
            if (!isSecretVar(key)) {
                cleanEnv.set(key, value);
            }
        }

        console.log("");

        const vaultAliases = listAliases();

        // Check if already configured
        const existingProvider = existingConfig?.llm?.provider ?? "openrouter";
        const providerEnvVar = PROVIDERS.find(p => p.name === existingProvider)?.envVar ?? "";
        const existingKey = getSecret(providerEnvVar);

        if (existingConfig && (existingKey || vaultAliases.length > 0)) {
            console.log(`  ${c.dim}Existing configuration detected:${c.reset}`);
            if (existingKey) {
                console.log(`  ${c.dim}  Provider: ${existingProvider}, Key (vault): ${existingKey.slice(0, 8)}...${c.reset}`);
            }
            if (vaultAliases.length > 0) {
                console.log(`  ${c.dim}  Vault secrets: ${vaultAliases.join(", ")}${c.reset}`);
            }
            console.log("");

            const reconfigure = await confirm({
                message: "Reconfigure?",
                default: false,
            });

            if (!reconfigure) {
                // Still save cleaned .env (removes secrets that were migrated)
                saveEnvFile(cleanEnv);
                console.log(`\n  ${c.green}✓ Keeping current configuration. Run ${c.bold}bun start${c.reset}${c.green} to launch.${c.reset}\n`);
                return;
            }
            console.log("");
        } else if (!existingConfig) {
            console.log(`  ${c.yellow}No configuration found — let's create one!${c.reset}`);
            console.log("");
        }

        // Step 1: Provider
        const provider = await stepProvider();

        // Step 2: API Key (saved to vault only)
        await stepApiKey(provider, cleanEnv);

        // Step 3: Tier
        const tier = await stepTier(provider);

        // Step 4: Telegram (saved to vault only)
        await stepTelegram(cleanEnv);

        // Step 5: Agent Name
        const agentName = await stepAgentName(existingConfig);

        // ── Generate full config from wizard data ─────────────────────
        const generatedConfig = buildDefaultConfig({
            provider: provider.name,
            tier,
            agentName,
        });

        // Preserve any custom fields from existing config
        if (existingConfig) {
            if (existingConfig.agent?.systemPromptExtra) {
                generatedConfig.agent.systemPromptExtra = existingConfig.agent.systemPromptExtra;
            }
            if (existingConfig.toolDefaults) {
                generatedConfig.toolDefaults = existingConfig.toolDefaults;
            }
            if (existingConfig.browser?.chromePath) {
                generatedConfig.browser.chromePath = existingConfig.browser.chromePath;
            }
            if (existingConfig.self?.jobs) {
                generatedConfig.self.jobs = existingConfig.self.jobs;
            }
        }

        saveConfigFile(generatedConfig);
        saveEnvFile(cleanEnv);

        // Print summary
        printSummary(generatedConfig);
    } catch (err: any) {
        if (err.message?.includes("closed") || err.name === "ExitPromptError") {
            console.log(`\n  ${c.dim}Setup cancelled.${c.reset}\n`);
        } else {
            console.error(`\n  ${c.red}Error: ${err.message}${c.reset}\n`);
        }
    }
}

// ── Direct execution ─────────────────────────────────────────────────────────
if (import.meta.main) {
    runSetupWizard().then(() => process.exit(0));
}
