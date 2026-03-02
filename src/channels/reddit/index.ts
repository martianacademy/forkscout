// src/channels/reddit/index.ts — Reddit channel (snoowrap polling + shared adapter)
// Raw JSON of every Reddit inbox item → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("reddit");

function getRole(username: string, config: AppConfig): "owner" | "user" | "denied" {
    const rd = (config as any).reddit;
    if (!rd) return "user";
    const u = username.toLowerCase();
    if (rd.ownerUsernames?.some((o: string) => o.toLowerCase() === u)) return "owner";
    return "user"; // Reddit is public — allow all by default
}

export default {
    name: "reddit",
    async start(config) {
        const clientId = process.env.REDDIT_CLIENT_ID;
        const clientSecret = process.env.REDDIT_CLIENT_SECRET;
        const username = process.env.REDDIT_USERNAME;
        const password = process.env.REDDIT_PASSWORD;
        if (!clientId || !clientSecret || !username || !password) {
            logger.warn("REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD not set — skipping"); return;
        }

        const Snoowrap = (await import("snoowrap")).default;
        const reddit = new Snoowrap({ userAgent: "forkscout-agent/1.0", clientId, clientSecret, username, password });

        const handler = createChannelHandler({
            channel: "reddit",
            historyBudget: (config as any).reddit?.historyTokenBudget ?? 12000,
            maxReplyLength: 10000, // Reddit comment limit
            sendReply: async (thingId, text) => {
                // thingId is the fullname (t1_ for comment, t4_ for message)
                const item = reddit.getSubmission(thingId) as any;
                await item.reply(text);
            },
        });

        const rd = (config as any).reddit;
        const pollInterval = rd?.pollIntervalMs ?? 30000;
        const seenIds = new Set<string>();

        const poll = async () => {
            try {
                const inbox = await reddit.getUnreadMessages();
                for (const item of inbox) {
                    const raw = (item as any).toJSON?.() ?? item;
                    if (seenIds.has(raw.name)) continue;
                    seenIds.add(raw.name);

                    const author = raw.author?.name ?? raw.author ?? "";
                    if (author.toLowerCase() === username.toLowerCase()) continue;

                    const role = getRole(author, config);
                    if (role === "denied") continue;

                    handler.enqueue(
                        config, raw, raw.name,
                        author, author, role,
                        rd?.rateLimitPerMinute ?? 10,
                    );

                    // Mark as read
                    await (item as any).markAsRead();
                }

                if (seenIds.size > 1000) {
                    const arr = [...seenIds];
                    arr.splice(0, arr.length - 500);
                    seenIds.clear();
                    arr.forEach(id => seenIds.add(id));
                }
            } catch (err: any) {
                logger.error(`Reddit poll error: ${err.message}`);
            }
        };

        logger.info(`✓ Reddit inbox polling started (every ${pollInterval / 1000}s)`);
        while (true) { await poll(); await new Promise(r => setTimeout(r, pollInterval)); }
    },
} satisfies Channel;
