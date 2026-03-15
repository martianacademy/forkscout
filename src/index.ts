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

import { applyCliOverrides } from "@/cli-parser.ts";
applyCliOverrides(config);

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

