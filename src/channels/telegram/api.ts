// src/channels/telegram/api.ts — Telegram Bot API helpers
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
