// src/index.ts — Entry point
import { loadConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import telegramChannel from "@/channels/telegram/index.ts";
import terminalChannel from "@/channels/terminal/index.ts";
import selfChannel, { startCronJobs, startHttpServer, checkOrphanedMonitors } from "@/channels/self/index.ts";
import whatsappChannel from "@/channels/whatsapp/index.ts";
import { startWhatsAppChannel, hasWhatsAppCredentials } from "@/channels/whatsapp/index.ts";
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
const channelName = process.argv.includes("--cli")
    ? "terminal"
    : process.argv.includes("--self")
        ? "self"
        : process.argv.includes("--whatsapp")
            ? "whatsapp"
            : "telegram";

const channels: Channel[] = [telegramChannel, terminalChannel, selfChannel, whatsappChannel];
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
    } else {
        logger.info("Smoke mode — HTTP server, cron jobs, and orphan monitor disabled");
    }
}

channel.start(config);

