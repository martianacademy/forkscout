// src/index.ts — Entry point
import { loadConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import telegramChannel from "@/channels/telegram/index.ts";
import terminalChannel from "@/channels/terminal/index.ts";
import selfChannel, { startCronJobs, startHttpServer, checkOrphanedMonitors } from "@/channels/self/index.ts";
import whatsappChannel from "@/channels/whatsapp/index.ts";
import { startWhatsAppChannel, hasWhatsAppCredentials } from "@/channels/whatsapp/index.ts";
import discordChannel from "@/channels/discord/index.ts";
import slackChannel from "@/channels/slack/index.ts";
import emailChannel from "@/channels/email/index.ts";
import matrixChannel from "@/channels/matrix/index.ts";
import webchatChannel from "@/channels/webchat/index.ts";
import teamsChannel from "@/channels/teams/index.ts";
import googleChatChannel from "@/channels/google_chat/index.ts";
import lineChannel from "@/channels/line/index.ts";
import viberChannel from "@/channels/viber/index.ts";
import messengerChannel from "@/channels/messenger/index.ts";
import instagramChannel from "@/channels/instagram/index.ts";
import twitterChannel from "@/channels/twitter/index.ts";
import redditChannel from "@/channels/reddit/index.ts";
import youtubeChannel from "@/channels/youtube/index.ts";
import smsChannel from "@/channels/sms/index.ts";
import { log } from "@/logs/logger.ts";
import { populateEnvFromVault } from "@/secrets/vault.ts";

// Setup wizard — runs and exits before anything else
if (process.argv.includes("--setup")) {
    const { runSetupWizard } = await import("@/setup/wizard.ts");
    await runSetupWizard();
    process.exit(0);
}

// Populate process.env from encrypted vault (secrets never stored in .env)
const vaultCount = populateEnvFromVault();

const logger = log("forkscout");
if (vaultCount > 0) {
    logger.info(`Loaded ${vaultCount} secret(s) from vault into process.env`);
}

const config = loadConfig();

// ── CLI LLM overrides — applied before initProviders ─────────────────────────
// Usage: forkscout start --provider openrouter --model "qwen/qwen3-14b" \
//          --tier balanced --url https://... --max-tokens 4096 --max-steps 30
{
    const arg = (flag: string): string | undefined => {
        const i = process.argv.indexOf(flag);
        return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
    };
    const flag = (name: string) => process.argv.includes(name);
    const ov = {
        provider: arg("--provider"),
        tier: arg("--tier"),
        model: arg("--model"),
        url: arg("--url"),
        apiKey: arg("--api-key"),
        maxTokens: arg("--max-tokens"),
        maxSteps: arg("--max-steps"),
        loopGuard: arg("--loop-guard"),
        reasoningTag: arg("--reasoning-tag"),
        compressWords: arg("--compress-words"),
        visionModel: arg("--vision-model"),
        summarizerModel: arg("--summarizer-model"),
        planFirst: flag("--plan-first"),
    };
    if (ov.provider) {
        logger.info(`[cli] provider override: ${config.llm.provider} → ${ov.provider}`);
        config.llm.provider = ov.provider;
    }
    if (ov.tier && ["fast", "balanced", "powerful"].includes(ov.tier)) {
        logger.info(`[cli] tier override: ${config.llm.tier} → ${ov.tier}`);
        (config.llm as any).tier = ov.tier;
    }
    if (ov.maxTokens) config.llm.maxTokens = parseInt(ov.maxTokens, 10);
    if (ov.maxSteps) config.llm.maxSteps = parseInt(ov.maxSteps, 10);
    if (ov.loopGuard) config.llm.loopGuardMaxConsecutive = parseInt(ov.loopGuard, 10);
    if (ov.reasoningTag) config.llm.reasoningTag = ov.reasoningTag;
    if (ov.compressWords) config.llm.toolResultAutoCompressWords = parseInt(ov.compressWords, 10);
    if (ov.planFirst) { config.llm.planFirst = true; logger.info("[cli] planFirst enabled"); }
    if (ov.model || ov.url || ov.apiKey || ov.visionModel || ov.summarizerModel) {
        const p = config.llm.provider;
        if (!config.llm.providers[p]) config.llm.providers[p] = { fast: "", balanced: "", powerful: "" };
        if (ov.model) {
            const t = config.llm.tier;
            logger.info(`[cli] model override (${p}/${t}): ${config.llm.providers[p][t]} → ${ov.model}`);
            (config.llm.providers[p] as any)[t] = ov.model;
        }
        if (ov.visionModel) {
            logger.info(`[cli] vision model override (${p}): ${ov.visionModel}`);
            (config.llm.providers[p] as any).vision = ov.visionModel;
        }
        if (ov.summarizerModel) {
            logger.info(`[cli] summarizer model override (${p}): ${ov.summarizerModel}`);
            (config.llm.providers[p] as any).summarizer = ov.summarizerModel;
        }
        if (ov.url) {
            logger.info(`[cli] baseURL override (${p}): ${ov.url}`);
            config.llm.providers[p]._baseURL = ov.url;
        }
        if (ov.apiKey) {
            logger.info(`[cli] apiKey override set for provider: ${p}`);
            config.llm.providers[p]._apiKey = ov.apiKey;
        }
    }
}

// Pre-register custom providers (ollama, lmstudio, etc.) from config
import { initProviders } from "@/providers/index.ts";
initProviders(config.llm);
// --channel <name> explicit flag takes precedence; legacy --cli/--self/--whatsapp still work
const _channelArg = (() => { const i = process.argv.indexOf("--channel"); return i !== -1 ? process.argv[i + 1] : undefined; })();
const channelName = _channelArg
    ?? (process.argv.includes("--cli") ? "terminal"
        : process.argv.includes("--self") ? "self"
            : process.argv.includes("--whatsapp") ? "whatsapp"
                : "telegram");

const channels: Channel[] = [
    telegramChannel, terminalChannel, selfChannel, whatsappChannel,
    discordChannel, slackChannel, emailChannel, matrixChannel, webchatChannel,
    teamsChannel, googleChatChannel, lineChannel, viberChannel, messengerChannel,
    instagramChannel, twitterChannel, redditChannel, youtubeChannel, smsChannel,
];
const channel = channels.find((c) => c.name === channelName);

if (!channel) throw new Error(`Unknown channel: ${channelName}`);

logger.info(`Starting channel: ${channel.name}`);

// When running telegram or terminal, start self subsystems in the background.
// Skip in smoke-test mode (FORKSCOUT_SMOKE=1) — we must not bind port 3200
// so the validate_and_restart smoke process doesn't steal the port from production.
if (channelName === "telegram" || channelName === "terminal") {
    if (process.env.FORKSCOUT_SMOKE !== "1") {
        startCronJobs(config);
        startHttpServer(config);
        checkOrphanedMonitors(config).catch(() => { });
        // Only auto-start WhatsApp if credentials exist (device already paired).
        // If not paired yet, the owner can initiate pairing from the dashboard.
        if (hasWhatsAppCredentials()) {
            startWhatsAppChannel();
        } else {
            logger.info("WhatsApp not paired yet — use Dashboard → Settings → WhatsApp to connect");
        }

        // Auto-start optional channels if their env vars are set
        const autoChannels = [
            discordChannel, slackChannel, emailChannel, matrixChannel,
            teamsChannel, googleChatChannel, lineChannel, viberChannel,
            messengerChannel, instagramChannel, twitterChannel, redditChannel,
            youtubeChannel, smsChannel,
        ];
        for (const ch of autoChannels) {
            ch.start(config).catch((err: Error) => logger.warn(`${ch.name} channel skipped: ${err.message}`));
        }
    } else {
        logger.info("Smoke mode — HTTP server, cron jobs, and orphan monitor disabled");
    }
}

channel.start(config);

