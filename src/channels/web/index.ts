// src/channels/web/index.ts — Web channel: browser-based chat with Clerk auth.
//
// The web channel serves users via a Next.js frontend (`web/` directory).
// It does NOT start its own HTTP server — the self channel's HTTP server
// handles /v1/* endpoints, and Next.js API routes proxy to them.
//
// This channel exists as a proper channel in the channel system for:
//   1. Clean architecture — web is a first-class channel alongside telegram/terminal
//   2. Future expansion — can own its own server, WebSocket support, etc.
//   3. Channel-specific logic — per-user history management, user lifecycle
//
// Auth flow:
//   Browser → Clerk auth → Next.js API routes → Agent HTTP API (X-User-Id header)
//
// Chat history: per-user at .agents/chats/web-{userId}/
//
// To start: `forkscout web` launches both the agent and Next.js frontend.

import type { Channel } from "@/channels/types.ts";
import type { AppConfig } from "@/config.ts";
import { log } from "@/logs/logger.ts";

const logger = log("web-channel");

/**
 * Start the web channel.
 *
 * In practice, the web channel's HTTP handling is done by the self channel's
 * Bun.serve (which handles /v1/* endpoints). The Next.js frontend is started
 * separately by `forkscout web` CLI command.
 *
 * This start() function is a placeholder for future direct web server support.
 * Currently it just logs and blocks forever.
 */
async function start(config: AppConfig): Promise<void> {
    logger.info("Web channel initialized (served via self channel HTTP + Next.js frontend)");
    logger.info("Start with: forkscout web");

    // Block forever — keeps the process alive
    await new Promise<never>(() => { /* never resolves */ });
}

export default {
    name: "web",
    start,
} satisfies Channel;
