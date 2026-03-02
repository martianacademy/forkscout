// src/channels/viber/index.ts — Viber channel (Viber Bot API webhook + shared adapter)
// Raw JSON of every Viber callback → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("viber");

function getRole(userId: string, config: AppConfig): "owner" | "user" | "denied" {
    const vb = (config as any).viber;
    if (!vb) return "user";
    if (vb.ownerIds?.includes(userId)) return "owner";
    if (vb.allowedUserIds?.length === 0) return "user";
    if (vb.allowedUserIds?.includes(userId)) return "user";
    return "denied";
}

export default {
    name: "viber",
    async start(config) {
        const authToken = process.env.VIBER_AUTH_TOKEN;
        const webhookUrl = process.env.VIBER_WEBHOOK_URL;
        if (!authToken) { logger.warn("VIBER_AUTH_TOKEN not set — skipping"); return; }

        const handler = createChannelHandler({
            channel: "viber",
            historyBudget: (config as any).viber?.historyTokenBudget ?? 12000,
            maxReplyLength: 7000, // Viber text limit
            sendReply: async (chatId, text) => {
                await fetch("https://chatapi.viber.com/pa/send_message", {
                    method: "POST",
                    headers: { "X-Viber-Auth-Token": authToken, "Content-Type": "application/json" },
                    body: JSON.stringify({ receiver: chatId, type: "text", text }),
                });
            },
        });

        const port = Number(process.env.VIBER_PORT ?? 3981);

        // Register webhook
        if (webhookUrl) {
            await fetch("https://chatapi.viber.com/pa/set_webhook", {
                method: "POST",
                headers: { "X-Viber-Auth-Token": authToken, "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrl, event_types: ["message"] }),
            });
        }

        Bun.serve({
            port,
            async fetch(req) {
                if (req.method !== "POST") return new Response("OK");
                const event = await req.json();
                if (event.event !== "message") return new Response(JSON.stringify({ status: 0 }));

                const userId = event.sender?.id ?? "";
                const name = event.sender?.name ?? "unknown";
                const role = getRole(userId, config);
                if (role === "denied") return new Response(JSON.stringify({ status: 0 }));

                handler.enqueue(
                    config, event, userId,
                    userId, name, role,
                    (config as any).viber?.rateLimitPerMinute ?? 15,
                );

                return new Response(JSON.stringify({ status: 0 }));
            },
        });

        logger.info(`✓ Viber webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
