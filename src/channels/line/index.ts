// src/channels/line/index.ts — LINE channel (@line/bot-sdk + shared adapter)
// Raw JSON of every LINE webhook event → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("line");

function getRole(userId: string, config: AppConfig): "owner" | "user" | "denied" {
    const ln = (config as any).line;
    if (!ln) return "user";
    if (ln.ownerIds?.includes(userId)) return "owner";
    if (ln.allowedUserIds?.length === 0) return "user";
    if (ln.allowedUserIds?.includes(userId)) return "user";
    return "denied";
}

export default {
    name: "line",
    async start(config) {
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const secret = process.env.LINE_CHANNEL_SECRET;
        if (!token || !secret) { logger.warn("LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET not set — skipping"); return; }

        const { messagingApi, middleware } = await import("@line/bot-sdk");
        const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });

        const handler = createChannelHandler({
            channel: "line",
            historyBudget: (config as any).line?.historyTokenBudget ?? 12000,
            maxReplyLength: 5000, // LINE text message limit
            sendReply: async (chatId, text) => {
                await client.pushMessage({ to: chatId, messages: [{ type: "text", text }] });
            },
        });

        const port = Number(process.env.LINE_PORT ?? 3980);

        Bun.serve({
            port,
            async fetch(req) {
                if (req.method !== "POST") return new Response("OK");
                const body = await req.json();
                const events = body.events ?? [];

                for (const event of events) {
                    if (event.type !== "message") continue;
                    const userId = event.source?.userId ?? "";
                    const chatId = event.source?.groupId ?? event.source?.roomId ?? userId;
                    const role = getRole(userId, config);
                    if (role === "denied") continue;

                    handler.enqueue(
                        config, event, chatId,
                        userId, userId, role,
                        (config as any).line?.rateLimitPerMinute ?? 15,
                    );
                }

                return new Response(JSON.stringify({ status: "ok" }));
            },
        });

        logger.info(`✓ LINE webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
