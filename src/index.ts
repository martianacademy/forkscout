// src/index.ts — Entry point
import { loadConfig } from "./config.ts";
import { startTelegram } from "./channels/telegram/index.ts";

const config = loadConfig();

console.log("[forkscout] Starting agent...");
startTelegram(config);
