// src/channels/voice/index.ts — Voice Call channel (Twilio Voice + STT/TTS + shared adapter)
// Incoming call → Twilio <Gather> STT → raw JSON to agent → TTS reply via <Say>.

import type { AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { createChannelHandler } from "@/channels/adapter.ts";
import { log } from "@/logs/logger.ts";

const logger = log("voice");

function getRole(phone: string, config: AppConfig): "owner" | "user" | "denied" {
    const vc = (config as any).voice;
    if (!vc) return "user";
    if (vc.ownerPhones?.includes(phone)) return "owner";
    if (vc.allowedPhones?.length === 0) return "user";
    if (vc.allowedPhones?.includes(phone)) return "user";
    return "denied";
}

// Pending replies: callSid → text
const pendingReplies = new Map<string, string>();

export default {
    name: "voice",
    async start(config) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) {
            logger.warn("TWILIO_ACCOUNT_SID/AUTH_TOKEN not set — skipping voice"); return;
        }

        const handler = createChannelHandler({
            channel: "voice",
            historyBudget: (config as any).voice?.historyTokenBudget ?? 12000,
            maxReplyLength: 4096,
            sendReply: async (callSid, text) => {
                // Store reply — the next /voice/reply webhook picks it up
                pendingReplies.set(callSid, text);
            },
        });

        const port = Number(process.env.VOICE_PORT ?? 3985);

        Bun.serve({
            port,
            async fetch(req) {
                const url = new URL(req.url);

                if (req.method === "POST" && url.pathname === "/voice/incoming") {
                    // Initial call → ask caller to speak
                    const params = new URLSearchParams(await req.text());
                    const from = params.get("From") ?? "";
                    const callSid = params.get("CallSid") ?? "";
                    const role = getRole(from, config);

                    if (role === "denied") {
                        return twiml("<Say>Access denied.</Say><Hangup/>");
                    }

                    return twiml(
                        `<Say>Hello, please speak after the beep.</Say>` +
                        `<Gather input="speech" action="/voice/speech?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}" speechTimeout="auto" language="en-US"/>` +
                        `<Say>I didn't hear anything. Goodbye.</Say><Hangup/>`
                    );
                }

                if (req.method === "POST" && url.pathname === "/voice/speech") {
                    // Twilio STT result → send to agent
                    const params = new URLSearchParams(await req.text());
                    const speech = params.get("SpeechResult") ?? "";
                    const from = url.searchParams.get("from") ?? params.get("From") ?? "";
                    const callSid = url.searchParams.get("callSid") ?? params.get("CallSid") ?? "";

                    const role = getRole(from, config);
                    if (role === "denied") return twiml("<Say>Access denied.</Say><Hangup/>");
                    const raw = { speech, from, callSid, confidence: params.get("Confidence") };

                    handler.enqueue(
                        config, raw, callSid,
                        from, from, role as "owner" | "user",
                        (config as any).voice?.rateLimitPerMinute ?? 5,
                    );

                    // Wait briefly for agent reply
                    await new Promise(r => setTimeout(r, 8000));
                    const reply = pendingReplies.get(callSid) ?? "I'm still thinking. Please call back.";
                    pendingReplies.delete(callSid);

                    return twiml(
                        `<Say>${escapeXml(reply)}</Say>` +
                        `<Gather input="speech" action="/voice/speech?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}" speechTimeout="auto" language="en-US"/>` +
                        `<Say>Goodbye.</Say><Hangup/>`
                    );
                }

                return new Response("OK");
            },
        });

        logger.info(`✓ Voice call webhook listening on port ${port}`);
        await new Promise(() => { }); // run forever
    },
} satisfies Channel;

function twiml(body: string): Response {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
        headers: { "Content-Type": "text/xml" },
    });
}

function escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
