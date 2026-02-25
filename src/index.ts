// src/index.ts — Entry point
import { loadConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import telegramChannel from "@/channels/telegram/index.ts";
import terminalChannel from "@/channels/terminal/index.ts";
import { log } from "@/logs/logger.ts";

const logger = log("forkscout");

const config = loadConfig();
const channelName = process.argv.includes("--cli") ? "terminal" : "telegram";

const channels: Channel[] = [telegramChannel, terminalChannel];
const channel = channels.find((c) => c.name === channelName);

if (!channel) throw new Error(`Unknown channel: ${channelName}`);

logger.info(`Starting channel: ${channel.name}`);
channel.start(config);
