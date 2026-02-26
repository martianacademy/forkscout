// src/tools/telegram_message_tools.ts
// Allows the agent to proactively send messages, media, files, and polls to Telegram chats.
// Used by self-cron jobs, background tasks, or any time the agent
// needs to reach someone without waiting for them to message first.

import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "@/config.ts";
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
import { mdToHtml, splitMessage, stripHtml } from "@/channels/telegram/format.ts";
import { loadHistory, saveHistory } from "@/channels/chat-store.ts";
import { log } from "@/logs/logger.ts";

export const IS_BOOTSTRAP_TOOL = false;

const logger = log("tool:telegram_message");

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveChatIds(action: string, chatId: number | undefined): { chatIds: number[]; error?: string } {
    const config = getConfig();
    if (action === "send_to_owners" || (!chatId && action !== "send")) {
        const ids = config.telegram?.ownerUserIds ?? [];
        if (ids.length === 0) return { chatIds: [], error: "No ownerUserIds configured in telegram config" };
        return { chatIds: ids };
    }
    if (!chatId) return { chatIds: [], error: "chat_id is required for this action" };
    return { chatIds: [chatId] };
}

function saveToHistory(chatIds: number[], text: string) {
    for (const chatId of chatIds) {
        const sessionKey = `telegram-${chatId}`;
        const history = loadHistory(sessionKey);
        saveHistory(sessionKey, [
            ...history,
            { role: "assistant", content: [{ type: "text", text }] },
        ]);
    }
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export const telegram_message_tools = tool({
    description:
        "Send messages and media to Telegram chats. Use proactively from cron jobs, background tasks, " +
        "or any time you need to reach the user without waiting for them to message you first. " +
        "Also use when a self-session (parallel worker or chain step) completes and needs to notify the user. " +
        "For media: provide a local file path (absolute) or a public HTTPS URL. " +
        "If chat_id is unknown in a self-session, use send_to_owners — it broadcasts to all configured owners.",
    inputSchema: z.object({
        action: z.enum([
            "send",
            "send_to_owners",
            "send_photo",
            "send_document",
            "send_voice",
            "send_audio",
            "send_video",
            "send_animation",
            "send_location",
            "send_poll",
        ]).describe(
            "Which type of message to send:\n" +
            "  send           — plain/markdown text to a specific chat_id (use when you know the chat_id). Max 4096 chars (auto-split)\n" +
            "  send_to_owners — plain/markdown text to ALL configured ownerUserIds (use in self-sessions when chat_id is unknown). Max 4096 chars\n" +
            "  send_photo     — image file or URL (JPG/PNG/WebP, max 10 MB via upload / 5 MB via URL). Use to share screenshots, charts, generated images\n" +
            "  send_document  — any file as a downloadable attachment (PDF, ZIP, CSV, JSON, code files, etc., max 50 MB)\n" +
            "  send_voice     — voice message from an OGG/Opus audio file (max 50 MB). Use after ElevenLabs TTS synthesis\n" +
            "  send_audio     — music/audio player card (MP3, M4A, max 50 MB). Shows title + performer, has seek controls\n" +
            "  send_video     — video file (MP4, max 50 MB). Use for screen recordings, demos, generated video content\n" +
            "  send_animation — looping GIF or silent MP4 (max 50 MB). Use for lightweight animated visuals\n" +
            "  send_location  — map pin at exact GPS coordinates. No file needed, just lat/lon\n" +
            "  send_poll      — interactive Telegram poll with 2–10 answer options (question max 300 chars, each option max 100 chars)"
        ),

        chat_id: z.number().optional().describe(
            "Telegram chat ID to send to. Required for action='send'. " +
            "For all other actions, omit to automatically broadcast to all ownerUserIds from config. " +
            "Use a positive integer (e.g. 123456789). Find it in activity logs or via @userinfobot.",
        ),

        // Text
        text: z.string().optional().describe(
            "Message text. Required for 'send' and 'send_to_owners'. " +
            "Supports Markdown: **bold**, *italic*, `code`, ```code block```, [link text](url). " +
            "Keep under 4096 characters (auto-split if longer).",
        ),

        // Media
        file_path_or_url: z.string().optional().describe(
            "Where to get the media file. Use an absolute local path (e.g. '/home/user/.forkscout/exports/report.pdf') " +
            "or a public HTTPS URL (e.g. 'https://example.com/image.png'). " +
            "Required for: send_photo, send_document, send_voice, send_audio, send_video, send_animation.",
        ),
        caption: z.string().optional().describe(
            "Short text shown below the media. Markdown supported. " +
            "Works with: send_photo, send_document, send_voice, send_audio, send_video, send_animation. " +
            "Max 1024 characters.",
        ),

        // Audio-specific
        audio_title: z.string().optional().describe(
            "Track/file title shown in the Telegram music player. Use for send_audio only. " +
            "Example: 'ForkScout Weekly Summary'",
        ),
        audio_performer: z.string().optional().describe(
            "Artist or source name shown in the Telegram music player. Use for send_audio only. " +
            "Example: 'ForkScout Agent'",
        ),

        // Location
        latitude: z.number().optional().describe(
            "GPS latitude in decimal degrees (e.g. 28.6139 for New Delhi). Required for send_location.",
        ),
        longitude: z.number().optional().describe(
            "GPS longitude in decimal degrees (e.g. 77.2090 for New Delhi). Required for send_location.",
        ),

        // Poll
        poll_question: z.string().optional().describe(
            "The question to ask in the poll. Required for send_poll. Max 300 characters. " +
            "Example: 'Which should I work on next?'",
        ),
        poll_options: z.array(z.string()).optional().describe(
            "List of 2–10 answer choices. Required for send_poll. Each option max 100 characters. " +
            "Example: [\"Fix the auth bug\", \"Add voice support\", \"Refactor DB layer\"]",
        ),
        poll_anonymous: z.boolean().optional().describe(
            "If true (default), voters are anonymous. Set false to show who voted what. send_poll only.",
        ),
    }),
    execute: async (input) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return { success: false, error: "TELEGRAM_BOT_TOKEN is not set" };

        const { action } = input;

        // ── Text ──────────────────────────────────────────────────────────────
        if (action === "send" || action === "send_to_owners") {
            if (!input.text) return { success: false, error: "text is required for this action" };

            const { chatIds, error } = resolveChatIds(action, input.chat_id);
            if (error) return { success: false, error };

            const html = mdToHtml(input.text);
            const sent: number[] = [];
            const failed: number[] = [];

            for (const chatId of chatIds) {
                let ok = false;
                for (const chunk of splitMessage(html)) {
                    const msgId = await sendMessage(token, chatId, chunk, "HTML");
                    if (msgId === null) {
                        logger.warn(`HTML rejected for chat ${chatId}, retrying as plain text`);
                        await sendMessage(token, chatId, stripHtml(chunk));
                        ok = true;
                    } else {
                        ok = true;
                    }
                }
                if (ok) sent.push(chatId); else failed.push(chatId);
            }

            if (failed.length > 0) logger.warn(`telegram_message: ${failed.length} delivery failure(s)`, failed);
            saveToHistory(sent, input.text);
            return { success: failed.length === 0, sent, failed };
        }

        // ── Media ─────────────────────────────────────────────────────────────
        const { chatIds, error } = resolveChatIds(action, input.chat_id);
        if (error) return { success: false, error };

        const sent: number[] = [];
        const failed: number[] = [];

        for (const chatId of chatIds) {
            let msgId: number | null = null;

            switch (action) {
                case "send_photo": {
                    if (!input.file_path_or_url) return { success: false, error: "file_path_or_url is required for send_photo" };
                    msgId = await sendPhoto(token, chatId, input.file_path_or_url, input.caption, input.caption ? "HTML" : "");
                    break;
                }
                case "send_document": {
                    if (!input.file_path_or_url) return { success: false, error: "file_path_or_url is required for send_document" };
                    msgId = await sendDocument(token, chatId, input.file_path_or_url, input.caption, input.caption ? "HTML" : "");
                    break;
                }
                case "send_voice": {
                    if (!input.file_path_or_url) return { success: false, error: "file_path_or_url is required for send_voice" };
                    msgId = await sendVoice(token, chatId, input.file_path_or_url, input.caption);
                    break;
                }
                case "send_audio": {
                    if (!input.file_path_or_url) return { success: false, error: "file_path_or_url is required for send_audio" };
                    msgId = await sendAudio(token, chatId, input.file_path_or_url, input.caption, input.audio_title, input.audio_performer);
                    break;
                }
                case "send_video": {
                    if (!input.file_path_or_url) return { success: false, error: "file_path_or_url is required for send_video" };
                    msgId = await sendVideo(token, chatId, input.file_path_or_url, input.caption, input.caption ? "HTML" : "");
                    break;
                }
                case "send_animation": {
                    if (!input.file_path_or_url) return { success: false, error: "file_path_or_url is required for send_animation" };
                    msgId = await sendAnimation(token, chatId, input.file_path_or_url, input.caption);
                    break;
                }
                case "send_location": {
                    if (input.latitude == null || input.longitude == null)
                        return { success: false, error: "latitude and longitude are required for send_location" };
                    msgId = await sendLocation(token, chatId, input.latitude, input.longitude);
                    break;
                }
                case "send_poll": {
                    if (!input.poll_question) return { success: false, error: "poll_question is required for send_poll" };
                    if (!input.poll_options || input.poll_options.length < 2)
                        return { success: false, error: "poll_options must have at least 2 items" };
                    if (input.poll_options.length > 10)
                        return { success: false, error: "poll_options can have at most 10 items" };
                    msgId = await sendPoll(token, chatId, input.poll_question, input.poll_options, input.poll_anonymous ?? true);
                    break;
                }
            }

            if (msgId !== null) sent.push(chatId); else failed.push(chatId);
        }

        if (failed.length > 0) logger.warn(`telegram_message ${action}: ${failed.length} failure(s)`, failed);
        return { success: failed.length === 0, sent, failed };
    },
});
