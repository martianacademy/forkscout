// src/channels/youtube/index.ts — YouTube Live Chat channel (Data API v3 polling + adapter)
// Raw JSON of every YouTube live chat message → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("youtube");

function getRole(channelId: string, config: AppConfig): "owner" | "user" | "denied" {
    const yt = (config as any).youtube;
    if (!yt) return "user";
    if (yt.ownerChannelIds?.includes(channelId)) return "owner";
    return "user"; // YouTube live chat is public
}

export default {
    name: "youtube",
    async start(config) {
        const apiKey = process.env.YOUTUBE_API_KEY;
        const liveChatId = process.env.YOUTUBE_LIVE_CHAT_ID;
        const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
        if (!apiKey || !liveChatId) { logger.warn("YOUTUBE_API_KEY or YOUTUBE_LIVE_CHAT_ID not set — skipping"); return; }

        const BASE = "https://www.googleapis.com/youtube/v3";

        const handler = createChannelHandler({
            channel: "youtube",
            historyBudget: (config as any).youtube?.historyTokenBudget ?? 12000,
            maxReplyLength: 200, // YouTube live chat limit
            sendReply: async (_chatId, text) => {
                if (!accessToken) { logger.warn("No YOUTUBE_ACCESS_TOKEN — can't reply"); return; }
                await fetch(`${BASE}/liveChat/messages?part=snippet`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        snippet: { liveChatId, type: "textMessageEvent", textMessageDetails: { messageText: text } },
                    }),
                });
            },
        });

        const yt = (config as any).youtube;
        let pageToken: string | undefined;
        let pollMs = yt?.pollIntervalMs ?? 5000;

        const poll = async () => {
            try {
                const url = new URL(`${BASE}/liveChat/messages`);
                url.searchParams.set("liveChatId", liveChatId);
                url.searchParams.set("part", "snippet,authorDetails");
                url.searchParams.set("key", apiKey);
                if (pageToken) url.searchParams.set("pageToken", pageToken);

                const res = await fetch(url.toString());
                const data = await res.json() as any;
                pageToken = data.nextPageToken;
                pollMs = data.pollingIntervalMillis ?? pollMs;

                for (const item of data.items ?? []) {
                    const channelId = item.authorDetails?.channelId ?? "";
                    const name = item.authorDetails?.displayName ?? "";
                    const role = getRole(channelId, config);
                    if (role === "denied") continue;

                    handler.enqueue(
                        config, item, liveChatId,
                        channelId, name, role,
                        yt?.rateLimitPerMinute ?? 30,
                    );
                }
            } catch (err: any) {
                logger.error(`YouTube poll error: ${err.message}`);
            }
        };

        logger.info(`✓ YouTube Live Chat polling started`);
        while (true) { await poll(); await new Promise(r => setTimeout(r, pollMs)); }
    },
} satisfies Channel;
