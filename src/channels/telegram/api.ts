// src/channels/telegram/api.ts — Telegram Bot API helpers
import { readFileSync } from "fs";
import { basename } from "path";
import { log } from "@/logs/logger.ts";

const logger = log("telegram/api");
const BASE = "https://api.telegram.org/bot";

export async function sendMessage(
    token: string,
    chatId: number,
    text: string,
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
    };

    try {
        const res = await fetch(`${BASE}${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string; error_code?: number };
        if (!data.ok) {
            logger.error(`sendMessage rejected by Telegram (${data.error_code}): ${data.description}`);
            return null;
        }
        return data.result?.message_id ?? null;
    } catch (err) {
        logger.error("sendMessage failed:", err);
        return null;
    }
}

export async function editMessage(
    token: string,
    chatId: number,
    messageId: number,
    text: string,
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<boolean> {
    const body: Record<string, unknown> = {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
    };

    try {
        const res = await fetch(`${BASE}${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; description?: string };

        if (!data.ok) {
            const desc = data.description ?? "";
            // "message is not modified" is not an error
            if (desc.includes("message is not modified")) return true;
            logger.error("editMessage failed:", desc);
            return false;
        }
        return true;
    } catch (err) {
        logger.error("editMessage error:", err);
        return false;
    }
}

export async function sendMessageWithInlineKeyboard(
    token: string,
    chatId: number,
    text: string,
    buttons: { text: string; callback_data: string }[][],
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: buttons },
        ...(parseMode ? { parse_mode: parseMode } : {}),
    };
    try {
        const res = await fetch(`${BASE}${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
        if (!data.ok) {
            logger.error(`sendMessageWithInlineKeyboard rejected: ${data.description}`);
            return null;
        }
        return data.result?.message_id ?? null;
    } catch (err) {
        logger.error("sendMessageWithInlineKeyboard failed:", err);
        return null;
    }
}

export async function answerCallbackQuery(
    token: string,
    callbackQueryId: string,
    text?: string
): Promise<void> {
    await fetch(`${BASE}${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    }).catch(() => { });
}

export async function editMessageReplyMarkup(
    token: string,
    chatId: number,
    messageId: number,
    buttons: { text: string; callback_data: string }[][] | null
): Promise<void> {
    await fetch(`${BASE}${token}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: buttons ? { inline_keyboard: buttons } : { inline_keyboard: [] },
        }),
    }).catch(() => { });
}

export async function sendTyping(token: string, chatId: number): Promise<void> {
    await fetch(`${BASE}${token}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    }).catch(() => { });
}

export async function deleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
    await fetch(`${BASE}${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    }).catch(() => { });
}

export async function setMessageReaction(
    token: string,
    chatId: number,
    messageId: number,
    emoji: string
): Promise<void> {
    await fetch(`${BASE}${token}/setMessageReaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reaction: [{ type: "emoji", emoji }],
            is_big: false,
        }),
    }).catch(() => { });
}

// ── Media helpers ─────────────────────────────────────────────────────────────
// Shared: sends URL via JSON, local file path via multipart FormData
async function sendMediaHelper(
    token: string,
    method: string,
    fieldName: string,
    chatId: number,
    fileOrUrl: string,
    extra: Record<string, string | number | boolean> = {}
): Promise<number | null> {
    const logger2 = log("telegram/api");
    const isUrl = fileOrUrl.startsWith("http://") || fileOrUrl.startsWith("https://");
    try {
        let res: Response;
        if (isUrl) {
            res = await fetch(`${BASE}${token}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, [fieldName]: fileOrUrl, ...extra }),
            });
        } else {
            const form = new FormData();
            form.set("chat_id", String(chatId));
            const bytes = readFileSync(fileOrUrl);
            form.set(fieldName, new Blob([bytes]), basename(fileOrUrl));
            for (const [k, v] of Object.entries(extra)) form.set(k, String(v));
            res = await fetch(`${BASE}${token}/${method}`, { method: "POST", body: form });
        }
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string; error_code?: number };
        if (!data.ok) {
            logger2.error(`${method} rejected (${data.error_code}): ${data.description}`);
            return null;
        }
        return data.result?.message_id ?? null;
    } catch (err) {
        log("telegram/api").error(`${method} failed:`, err);
        return null;
    }
}

/**
 * Send a photo. `photoPathOrUrl` can be an HTTPS URL or a local file path (JPG/PNG/WebP).
 * Telegram limits: 10 MB for photos, 5 MB via URL.
 */
export async function sendPhoto(
    token: string,
    chatId: number,
    photoPathOrUrl: string,
    caption?: string,
    parseMode: "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const extra: Record<string, string | number | boolean> = {};
    if (caption) extra.caption = caption;
    if (parseMode) extra.parse_mode = parseMode;
    return sendMediaHelper(token, "sendPhoto", "photo", chatId, photoPathOrUrl, extra);
}

/**
 * Send any file as a document. `filePathOrUrl` can be an HTTPS URL or local path.
 * Telegram limit: 50 MB.
 */
export async function sendDocument(
    token: string,
    chatId: number,
    filePathOrUrl: string,
    caption?: string,
    parseMode: "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const extra: Record<string, string | number | boolean> = {};
    if (caption) extra.caption = caption;
    if (parseMode) extra.parse_mode = parseMode;
    return sendMediaHelper(token, "sendDocument", "document", chatId, filePathOrUrl, extra);
}

/**
 * Send a voice message. File must be OGG/Opus format (Telegram requirement).
 * Generate from ElevenLabs TTS then convert if needed.
 * Telegram limit: 50 MB.
 */
export async function sendVoice(
    token: string,
    chatId: number,
    filePathOrUrl: string,
    caption?: string
): Promise<number | null> {
    const extra: Record<string, string | number | boolean> = {};
    if (caption) extra.caption = caption;
    return sendMediaHelper(token, "sendVoice", "voice", chatId, filePathOrUrl, extra);
}

/**
 * Send an audio file (shown as music player in Telegram). MP3, M4A, FLAC etc.
 * Telegram limit: 50 MB.
 */
export async function sendAudio(
    token: string,
    chatId: number,
    filePathOrUrl: string,
    caption?: string,
    title?: string,
    performer?: string
): Promise<number | null> {
    const extra: Record<string, string | number | boolean> = {};
    if (caption) extra.caption = caption;
    if (title) extra.title = title;
    if (performer) extra.performer = performer;
    return sendMediaHelper(token, "sendAudio", "audio", chatId, filePathOrUrl, extra);
}

/**
 * Send a video. MP4 recommended.
 * Telegram limit: 50 MB.
 */
export async function sendVideo(
    token: string,
    chatId: number,
    filePathOrUrl: string,
    caption?: string,
    parseMode: "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const extra: Record<string, string | number | boolean> = {};
    if (caption) extra.caption = caption;
    if (parseMode) extra.parse_mode = parseMode;
    return sendMediaHelper(token, "sendVideo", "video", chatId, filePathOrUrl, extra);
}

/**
 * Send an animation (GIF or MP4 without sound).
 */
export async function sendAnimation(
    token: string,
    chatId: number,
    filePathOrUrl: string,
    caption?: string
): Promise<number | null> {
    const extra: Record<string, string | number | boolean> = {};
    if (caption) extra.caption = caption;
    return sendMediaHelper(token, "sendAnimation", "animation", chatId, filePathOrUrl, extra);
}

/**
 * Send a map pin (live or static location).
 */
export async function sendLocation(
    token: string,
    chatId: number,
    latitude: number,
    longitude: number
): Promise<number | null> {
    try {
        const res = await fetch(`${BASE}${token}/sendLocation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, latitude, longitude }),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
        if (!data.ok) { log("telegram/api").error("sendLocation failed:", data.description); return null; }
        return data.result?.message_id ?? null;
    } catch (err) {
        log("telegram/api").error("sendLocation error:", err);
        return null;
    }
}

/**
 * Send a native Telegram poll.
 * @param options — 2–10 answer strings
 * @param isAnonymous — default true
 */
export async function sendPoll(
    token: string,
    chatId: number,
    question: string,
    options: string[],
    isAnonymous = true
): Promise<number | null> {
    try {
        const res = await fetch(`${BASE}${token}/sendPoll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                question,
                options: options.map((text) => ({ text })),
                is_anonymous: isAnonymous,
            }),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
        if (!data.ok) { log("telegram/api").error("sendPoll failed:", data.description); return null; }
        return data.result?.message_id ?? null;
    } catch (err) {
        log("telegram/api").error("sendPoll error:", err);
        return null;
    }
}
