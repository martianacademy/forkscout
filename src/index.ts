// src/index.ts — Entry point
import { loadConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import telegramChannel from "@/channels/telegram/index.ts";
import terminalChannel from "@/channels/terminal/index.ts";
import selfChannel, { startCronJobs, startHttpServer, checkOrphanedMonitors } from "@/channels/self/index.ts";
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
        : "telegram";

const channels: Channel[] = [telegramChannel, terminalChannel, selfChannel];
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
    } else {
        logger.info("Smoke mode — HTTP server, cron jobs, and orphan monitor disabled");
    }
}

channel.start(config);

