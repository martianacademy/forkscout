// src/channels/sms/index.ts — SMS channel (Twilio webhook + shared adapter)
// Raw JSON of every Twilio SMS webhook → agent. Zero message parsing — future-proof.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("sms");

function getRole(phone: string, config: AppConfig): "owner" | "user" | "denied" {
    const sm = (config as any).sms;
    if (!sm) return "user";
    if (sm.ownerPhones?.includes(phone)) return "owner";
    if (sm.allowedPhones?.length === 0) return "user";
    if (sm.allowedPhones?.includes(phone)) return "user";
    return "denied";
}

export default {
    name: "sms",
    async start(config) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        if (!accountSid || !authToken || !fromNumber) {
            logger.warn("TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER not set — skipping"); return;
        }

        const twilio = (await import("twilio")).default;
        const client = twilio(accountSid, authToken);

        const handler = createChannelHandler({
            channel: "sms",
            historyBudget: (config as any).sms?.historyTokenBudget ?? 12000,
            maxReplyLength: 1600, // SMS segment limit
            sendReply: async (toPhone, text) => {
                await client.messages.create({ body: text, from: fromNumber, to: toPhone });
            },
        });

        const port = Number(process.env.SMS_PORT ?? 3984);

        Bun.serve({
            port,
            async fetch(req) {
                if (req.method !== "POST") return new Response("OK");

                // Twilio sends form-urlencoded
                const text = await req.text();
                const params = new URLSearchParams(text);
                const raw = Object.fromEntries(params.entries());

                const from = raw.From ?? "";
                const role = getRole(from, config);
                if (role === "denied") return new Response("<Response></Response>", {
                    headers: { "Content-Type": "text/xml" },
                });

                handler.enqueue(
                    config, raw, from,
                    from, from, role,
                    (config as any).sms?.rateLimitPerMinute ?? 10,
                );

                // Return empty TwiML — we reply async via REST API
                return new Response("<Response></Response>", {
                    headers: { "Content-Type": "text/xml" },
                });
            },
        });

        logger.info(`✓ SMS (Twilio) webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;
