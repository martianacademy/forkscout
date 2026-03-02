// src/channels/messenger/index.ts — Facebook Messenger channel (Platform API webhook + adapter)
// Raw JSON of every Messenger event → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("messenger");

function getRole(psid: string, config: AppConfig): "owner" | "user" | "denied" {
    const fb = (config as any).messenger;
    if (!fb) return "user";
    if (fb.ownerPsids?.includes(psid)) return "owner";
    if (fb.allowedPsids?.length === 0) return "user";
    if (fb.allowedPsids?.includes(psid)) return "user";
    return "denied";
}

export default {
    name: "messenger",
    async start(config) {
        const token = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
        const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;
        if (!token) { logger.warn("MESSENGER_PAGE_ACCESS_TOKEN not set — skipping"); return; }

        const handler = createChannelHandler({
            channel: "messenger",
            historyBudget: (config as any).messenger?.historyTokenBudget ?? 12000,
            maxReplyLength: 2000, // Messenger limit
            sendReply: async (psid, text) => {
                await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
                });
            },
        });

        const port = Number(process.env.MESSENGER_PORT ?? 3982);

        Bun.serve({
            port,
            async fetch(req) {
                const url = new URL(req.url);

                // Webhook verification (GET)
                if (req.method === "GET" && url.pathname === "/webhook") {
                    const mode = url.searchParams.get("hub.mode");
                    const tok = url.searchParams.get("hub.verify_token");
                    const challenge = url.searchParams.get("hub.challenge");
                    if (mode === "subscribe" && tok === verifyToken) return new Response(challenge ?? "");
                    return new Response("Forbidden", { status: 403 });
                }

                if (req.method !== "POST") return new Response("OK");
                const body = await req.json();

                for (const entry of body.entry ?? []) {
                    for (const event of entry.messaging ?? []) {
                        if (!event.message) continue;
                        const psid = event.sender?.id ?? "";
                        const role = getRole(psid, config);
                        if (role === "denied") continue;

                        handler.enqueue(
                            config, event, psid,
                            psid, psid, role,
                            (config as any).messenger?.rateLimitPerMinute ?? 15,
                        );
                    }
                }

                return new Response("EVENT_RECEIVED");
            },
        });

        logger.info(`✓ Messenger webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
