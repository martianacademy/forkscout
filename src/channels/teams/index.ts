// src/channels/teams/index.ts — Microsoft Teams channel (Bot Framework + shared adapter)
// Raw JSON of every Teams Activity → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("teams");

function getRole(userId: string, config: AppConfig): "owner" | "user" | "denied" {
    const t = (config as any).teams;
    if (!t) return "user"; // no config = allow all
    if (t.ownerIds?.includes(userId)) return "owner";
    if (t.allowedUserIds?.length === 0) return "user";
    if (t.allowedUserIds?.includes(userId)) return "user";
    return "denied";
}

export default {
    name: "teams",
    async start(config) {
        const appId = process.env.TEAMS_APP_ID;
        const appPassword = process.env.TEAMS_APP_PASSWORD;
        if (!appId || !appPassword) { logger.warn("TEAMS_APP_ID or TEAMS_APP_PASSWORD not set — skipping"); return; }

        const { BotFrameworkAdapter, ActivityTypes } = await import("botbuilder");
        const adapter = new BotFrameworkAdapter({ appId, appPassword });

        const refs = new Map<string, any>(); // store conversation references for replies

        const handler = createChannelHandler({
            channel: "teams",
            historyBudget: (config as any).teams?.historyTokenBudget ?? 12000,
            maxReplyLength: 28000,
            sendReply: async (chatId, text) => {
                const ref = refs.get(chatId);
                if (!ref) return;
                await adapter.continueConversation(ref, async (ctx) => {
                    await ctx.sendActivity(text);
                });
            },
        });

        const port = Number(process.env.TEAMS_PORT ?? 3978);

        Bun.serve({
            port,
            async fetch(req) {
                if (new URL(req.url).pathname !== "/api/messages") return new Response("OK");
                const body = await req.json();
                await adapter.processActivity(req as any, {} as any, async (ctx) => {
                    if (ctx.activity.type !== ActivityTypes.Message) return;
                    const userId = ctx.activity.from?.aadObjectId ?? ctx.activity.from?.id ?? "";
                    const chatId = ctx.activity.conversation?.id ?? "";
                    const name = ctx.activity.from?.name ?? "unknown";

                    refs.set(chatId, { ...ctx.activity, serviceUrl: ctx.activity.serviceUrl });
                    const role = getRole(userId, config);
                    if (role === "denied") return;

                    handler.enqueue(
                        config, ctx.activity, chatId,
                        userId, name, role,
                        (config as any).teams?.rateLimitPerMinute ?? 15,
                    );
                });
                return new Response("OK");
            },
        });

        logger.info(`✓ Teams bot listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
