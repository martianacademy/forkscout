// src/tools/send_telegram_tools.ts — Send any message type to Telegram and sync to chat history.
// Supports: text, photo, document, voice, audio, video, animation, location, poll, sticker, contact, venue.
// This is the SINGLE choke point for outbound Telegram messages from the agent —
// every send also appends to the recipient's chat history so context is never lost.

import { tool } from "ai";
import { z } from "zod";
import { appendHistory } from "@/channels/chat-store.ts";
import {
    sendMessage,
    sendPhoto,
    sendDocument,
    sendVoice,
    sendAudio,
    sendVideo,
    sendAnimation,
    sendLocation,
    sendPoll,
} from "@/channels/telegram/api.ts";
import { log } from "@/logs/logger.ts";

const logger = log("tool:send_telegram");

export const IS_BOOTSTRAP_TOOL = false;

export const send_telegram_tools = tool({
    description:
        "Send a message to a Telegram chat. Supports all message types: text, photo, document, voice, audio, video, animation, location, poll, sticker, contact, venue. " +
        "Use this to proactively send messages, results, files, media, or notifications to any Telegram chat. " +
        "The chatId is available from the incoming message metadata (the raw JSON). For the current user, use their chat.id. " +
        "Every sent message is automatically appended to the recipient's chat history for context continuity.",
    inputSchema: z.object({
        chat_id: z.number().describe("Telegram chat ID to send to. Use the chat.id from the incoming message."),
        type: z
            .enum(["text", "photo", "document", "voice", "audio", "video", "animation", "location", "poll", "sticker", "contact", "venue"])
            .describe("Message type to send."),
        // ── Text / caption ────────────────────────────────────────────────────
        text: z.string().optional().describe("Text content (for 'text' type) or caption (for media types)."),
        parse_mode: z
            .enum(["HTML", "Markdown", ""])
            .optional()
            .default("")
            .describe("Parse mode for text/caption formatting. Use HTML for rich formatting."),
        // ── Media (file path or URL) ──────────────────────────────────────────
        file: z.string().optional().describe("File path or HTTPS URL for media types (photo, document, voice, audio, video, animation, sticker)."),
        // ── Audio extras ──────────────────────────────────────────────────────
        title: z.string().optional().describe("Track title (audio type only)."),
        performer: z.string().optional().describe("Artist/performer name (audio type only)."),
        // ── Location ──────────────────────────────────────────────────────────
        latitude: z.number().optional().describe("Latitude for location/venue type."),
        longitude: z.number().optional().describe("Longitude for location/venue type."),
        // ── Venue extras ──────────────────────────────────────────────────────
        venue_title: z.string().optional().describe("Venue name (venue type only)."),
        venue_address: z.string().optional().describe("Venue address (venue type only)."),
        // ── Poll ──────────────────────────────────────────────────────────────
        question: z.string().optional().describe("Poll question (poll type only)."),
        options: z.array(z.string()).optional().describe("Poll options, 2-10 items (poll type only)."),
        is_anonymous: z.boolean().optional().default(true).describe("Whether poll is anonymous (poll type only)."),
        // ── Contact ───────────────────────────────────────────────────────────
        phone_number: z.string().optional().describe("Phone number (contact type only)."),
        first_name: z.string().optional().describe("First name (contact type only)."),
        last_name: z.string().optional().describe("Last name (contact type only)."),
    }),
    execute: async (input) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            return { success: false, error: "TELEGRAM_BOT_TOKEN not set" };
        }

        const chatId = input.chat_id;
        let messageId: number | null = null;
        let historyContent = "";

        try {
            switch (input.type) {
                case "text": {
                    if (!input.text) return { success: false, error: "text is required for type 'text'" };
                    messageId = await sendMessage(token, chatId, input.text, input.parse_mode as any || "", true);
                    // sync=true handles history append
                    historyContent = "";
                    break;
                }
                case "photo": {
                    if (!input.file) return { success: false, error: "file is required for type 'photo'" };
                    messageId = await sendPhoto(token, chatId, input.file, input.text, input.parse_mode as any || "");
                    historyContent = `[Sent photo: ${input.file}${input.text ? ` · caption: ${input.text}` : ""}]`;
                    break;
                }
                case "document": {
                    if (!input.file) return { success: false, error: "file is required for type 'document'" };
                    messageId = await sendDocument(token, chatId, input.file, input.text, input.parse_mode as any || "");
                    historyContent = `[Sent document: ${input.file}${input.text ? ` · caption: ${input.text}` : ""}]`;
                    break;
                }
                case "voice": {
                    if (!input.file) return { success: false, error: "file is required for type 'voice'" };
                    messageId = await sendVoice(token, chatId, input.file, input.text);
                    historyContent = `[Sent voice: ${input.file}]`;
                    break;
                }
                case "audio": {
                    if (!input.file) return { success: false, error: "file is required for type 'audio'" };
                    messageId = await sendAudio(token, chatId, input.file, input.text, input.title, input.performer);
                    historyContent = `[Sent audio: ${input.file}${input.title ? ` · "${input.title}"` : ""}]`;
                    break;
                }
                case "video": {
                    if (!input.file) return { success: false, error: "file is required for type 'video'" };
                    messageId = await sendVideo(token, chatId, input.file, input.text, input.parse_mode as any || "");
                    historyContent = `[Sent video: ${input.file}${input.text ? ` · caption: ${input.text}` : ""}]`;
                    break;
                }
                case "animation": {
                    if (!input.file) return { success: false, error: "file is required for type 'animation'" };
                    messageId = await sendAnimation(token, chatId, input.file, input.text);
                    historyContent = `[Sent animation: ${input.file}]`;
                    break;
                }
                case "location": {
                    if (input.latitude == null || input.longitude == null) {
                        return { success: false, error: "latitude and longitude are required for type 'location'" };
                    }
                    messageId = await sendLocation(token, chatId, input.latitude, input.longitude);
                    historyContent = `[Sent location: lat=${input.latitude}, lon=${input.longitude}]`;
                    break;
                }
                case "venue": {
                    if (input.latitude == null || input.longitude == null || !input.venue_title || !input.venue_address) {
                        return { success: false, error: "latitude, longitude, venue_title, and venue_address are required for type 'venue'" };
                    }
                    // Venue uses raw Telegram API — not in api.ts yet, call directly
                    const BASE = "https://api.telegram.org/bot";
                    const res = await fetch(`${BASE}${token}/sendVenue`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: chatId,
                            latitude: input.latitude,
                            longitude: input.longitude,
                            title: input.venue_title,
                            address: input.venue_address,
                        }),
                    });
                    const data = await res.json() as { ok: boolean; result?: { message_id: number } };
                    messageId = data.ok ? (data.result?.message_id ?? null) : null;
                    historyContent = `[Sent venue: "${input.venue_title}" at ${input.venue_address}]`;
                    break;
                }
                case "sticker": {
                    if (!input.file) return { success: false, error: "file (sticker file_id or URL) is required for type 'sticker'" };
                    const BASE = "https://api.telegram.org/bot";
                    const res = await fetch(`${BASE}${token}/sendSticker`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: chatId, sticker: input.file }),
                    });
                    const data = await res.json() as { ok: boolean; result?: { message_id: number } };
                    messageId = data.ok ? (data.result?.message_id ?? null) : null;
                    historyContent = `[Sent sticker: ${input.file}]`;
                    break;
                }
                case "contact": {
                    if (!input.phone_number || !input.first_name) {
                        return { success: false, error: "phone_number and first_name are required for type 'contact'" };
                    }
                    const BASE = "https://api.telegram.org/bot";
                    const res = await fetch(`${BASE}${token}/sendContact`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: chatId,
                            phone_number: input.phone_number,
                            first_name: input.first_name,
                            ...(input.last_name ? { last_name: input.last_name } : {}),
                        }),
                    });
                    const data = await res.json() as { ok: boolean; result?: { message_id: number } };
                    messageId = data.ok ? (data.result?.message_id ?? null) : null;
                    historyContent = `[Sent contact: ${input.first_name} ${input.last_name ?? ""} · ${input.phone_number}]`;
                    break;
                }
                case "poll": {
                    if (!input.question || !input.options || input.options.length < 2) {
                        return { success: false, error: "question and options (2-10 items) are required for type 'poll'" };
                    }
                    messageId = await sendPoll(token, chatId, input.question, input.options, input.is_anonymous);
                    historyContent = `[Sent poll: "${input.question}" — ${input.options.join(" | ")}]`;
                    break;
                }
                default:
                    return { success: false, error: `Unsupported message type: ${input.type}` };
            }

            if (messageId === null) {
                return { success: false, error: `Telegram API rejected the ${input.type} message` };
            }

            // ── Sync media sends to recipient's Telegram chat history ─────────
            // Text is already synced by sendMessage. For media types, append manually.
            if (historyContent) {
                appendHistory(`telegram-${chatId}`, [{ role: "assistant", content: historyContent }]);
            }

            logger.info(`Sent ${input.type} to chat ${chatId} (msg_id: ${messageId})`);
            return { success: true, message_id: messageId, type: input.type };

        } catch (err: any) {
            logger.error(`Failed to send ${input.type} to chat ${chatId}:`, err.message);
            return { success: false, error: err.message ?? String(err) };
        }
    },
});
