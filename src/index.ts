// src/index.ts — Entry point
import { loadConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import telegramChannel from "@/channels/telegram/index.ts";
import terminalChannel from "@/channels/terminal/index.ts";
import selfChannel, { startCronJobs, startHttpServer, checkOrphanedMonitors } from "@/channels/self/index.ts";
import { log } from "@/logs/logger.ts";

const logger = log("forkscout");

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

// When running telegram or terminal, start self subsystems in the background
if (channelName === "telegram" || channelName === "terminal") {
    startCronJobs(config);
    startHttpServer(config);
    checkOrphanedMonitors(config).catch(() => { });
}

channel.start(config);

