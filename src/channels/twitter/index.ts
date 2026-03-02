// src/channels/twitter/index.ts — Twitter/X DMs channel (X API v2 polling + shared adapter)
// Raw JSON of every X DM event → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";
import { TwitterApi } from "twitter-api-v2";

const logger = log("twitter");

function getRole(userId: string, config: AppConfig): "owner" | "user" | "denied" {
    const tw = (config as any).twitter;
    if (!tw) return "user";
    if (tw.ownerIds?.includes(userId)) return "owner";
    if (tw.allowedUserIds?.length === 0) return "user";
    if (tw.allowedUserIds?.includes(userId)) return "user";
    return "denied";
}

export default {
    name: "twitter",
    async start(config) {
        const appKey = process.env.TWITTER_API_KEY;
        const appSecret = process.env.TWITTER_API_SECRET;
        const accessToken = process.env.TWITTER_ACCESS_TOKEN;
        const accessSecret = process.env.TWITTER_ACCESS_SECRET;
        if (!appKey || !appSecret || !accessToken || !accessSecret) {
            logger.warn("TWITTER_API_KEY/SECRET or ACCESS_TOKEN/SECRET not set — skipping"); return;
        }

        const client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
        const me = await client.v2.me();
        const myId = me.data.id;

        const handler = createChannelHandler({
            channel: "twitter",
            historyBudget: (config as any).twitter?.historyTokenBudget ?? 12000,
            maxReplyLength: 10000, // DM text limit
            sendReply: async (recipientId, text) => {
                await client.v2.sendDmInConversation(
                    `${myId}-${recipientId}`,
                    { text },
                );
            },
        });

        const tw = (config as any).twitter;
        const pollInterval = tw?.pollIntervalMs ?? 30000;
        const seenIds = new Set<string>();

        const poll = async () => {
            try {
                const events = await client.v2.listDmEvents({ "dm_event.fields": ["sender_id", "text", "created_at"] });
                for (const event of events.data?.data ?? []) {
                    if (seenIds.has(event.id)) continue;
                    seenIds.add(event.id);

                    const senderId = event.sender_id ?? "";
                    if (senderId === myId) continue; // skip own messages

                    const role = getRole(senderId, config);
                    if (role === "denied") continue;

                    handler.enqueue(
                        config, event, senderId,
                        senderId, senderId, role,
                        tw?.rateLimitPerMinute ?? 15,
                    );
                }
                // Keep set from growing unbounded
                if (seenIds.size > 1000) {
                    const arr = [...seenIds];
                    arr.splice(0, arr.length - 500);
                    seenIds.clear();
                    arr.forEach(id => seenIds.add(id));
                }
            } catch (err: any) {
                logger.error(`X API poll error: ${err.message}`);
            }
        };

        logger.info(`✓ Twitter/X DM polling started (every ${pollInterval / 1000}s)`);
        while (true) { await poll(); await new Promise(r => setTimeout(r, pollInterval)); }
    },
} satisfies Channel;
