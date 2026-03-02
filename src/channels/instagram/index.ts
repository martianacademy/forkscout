// src/channels/instagram/index.ts — Instagram DMs channel (Graph API webhook + adapter)
// Raw JSON of every Instagram webhook event → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("instagram");

function getRole(igId: string, config: AppConfig): "owner" | "user" | "denied" {
    const ig = (config as any).instagram;
    if (!ig) return "user";
    if (ig.ownerIgIds?.includes(igId)) return "owner";
    if (ig.allowedIgIds?.length === 0) return "user";
    if (ig.allowedIgIds?.includes(igId)) return "user";
    return "denied";
}

export default {
    name: "instagram",
    async start(config) {
        const token = process.env.INSTAGRAM_ACCESS_TOKEN;
        const verifyToken = process.env.INSTAGRAM_VERIFY_TOKEN;
        if (!token) { logger.warn("INSTAGRAM_ACCESS_TOKEN not set — skipping"); return; }

        const handler = createChannelHandler({
            channel: "instagram",
            historyBudget: (config as any).instagram?.historyTokenBudget ?? 12000,
            maxReplyLength: 1000, // IG DM limit
            sendReply: async (igScopedId, text) => {
                await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${token}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ recipient: { id: igScopedId }, message: { text } }),
                });
            },
        });

        const port = Number(process.env.INSTAGRAM_PORT ?? 3983);

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
                        const senderId = event.sender?.id ?? "";
                        const role = getRole(senderId, config);
                        if (role === "denied") continue;

                        handler.enqueue(
                            config, event, senderId,
                            senderId, senderId, role,
                            (config as any).instagram?.rateLimitPerMinute ?? 15,
                        );
                    }
                }

                return new Response("EVENT_RECEIVED");
            },
        });

        logger.info(`✓ Instagram DM webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
