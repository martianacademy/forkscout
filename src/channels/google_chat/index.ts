// src/channels/google_chat/index.ts — Google Chat channel (webhook + shared adapter)
// Raw JSON of every Google Chat event → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("google-chat");

function getRole(email: string, config: AppConfig): "owner" | "user" | "denied" {
    const gc = (config as any).googleChat;
    if (!gc) return "user";
    if (gc.ownerEmails?.some((e: string) => email.toLowerCase() === e.toLowerCase())) return "owner";
    if (gc.allowedEmails?.length === 0) return "user";
    if (gc.allowedEmails?.some((e: string) => email.toLowerCase() === e.toLowerCase())) return "user";
    return "denied";
}

export default {
    name: "google_chat",
    async start(config) {
        const saPath = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
        if (!saPath) { logger.warn("GOOGLE_CHAT_SERVICE_ACCOUNT not set — skipping"); return; }

        // Google Chat sends events via webhook push to our HTTP endpoint.
        // We reply inline in the response or via the REST API.
        const { google } = await import("googleapis");
        const auth = new google.auth.GoogleAuth({
            keyFile: saPath,
            scopes: ["https://www.googleapis.com/auth/chat.bot"],
        });
        const chat = google.chat({ version: "v1", auth });

        const handler = createChannelHandler({
            channel: "google_chat",
            historyBudget: (config as any).googleChat?.historyTokenBudget ?? 12000,
            maxReplyLength: 4096,
            sendReply: async (spaceId, text) => {
                await chat.spaces.messages.create({
                    parent: spaceId,
                    requestBody: { text },
                });
            },
        });

        const port = Number(process.env.GOOGLE_CHAT_WEBHOOK_PORT ?? 3979);

        Bun.serve({
            port,
            async fetch(req) {
                if (req.method !== "POST") return new Response("OK");
                const event = await req.json();
                if (event.type !== "MESSAGE") return new Response(JSON.stringify({}));

                const email = event.message?.sender?.email ?? event.user?.email ?? "";
                const spaceId = event.space?.name ?? "";
                const name = event.message?.sender?.displayName ?? "unknown";

                const role = getRole(email, config);
                if (role === "denied") return new Response(JSON.stringify({}));

                handler.enqueue(
                    config, event, spaceId,
                    email, name, role,
                    (config as any).googleChat?.rateLimitPerMinute ?? 15,
                );

                return new Response(JSON.stringify({})); // async — reply via API
            },
        });

        logger.info(`✓ Google Chat webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
