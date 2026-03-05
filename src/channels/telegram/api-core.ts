// src/channels/telegram/api-core.ts — Core Telegram text/message API helpers

import { log } from "@/logs/logger.ts";

const logger = log("telegram/api");
export const BASE = "https://api.telegram.org/bot";

/** Extract retry-after seconds from a Telegram 429 description, or return 0 */
function retryAfterSecs(description: string): number {
    const m = description.match(/retry after (\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
}

export async function sendMessage(
    token: string, chatId: number, text: string,
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const body: Record<string, unknown> = {
        chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}),
    };
    try {
        const res = await fetch(`${BASE}${token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string; parameters?: { retry_after?: number } };
        if (!data.ok) {
            const secs = retryAfterSecs(data.description ?? "") || data.parameters?.retry_after;
            if (secs) {
                logger.warn(`sendMessage: rate limited, waiting ${secs}s`);
                await new Promise((r) => setTimeout(r, secs * 1000));
                return sendMessage(token, chatId, text, parseMode);
            }
            logger.error(`sendMessage rejected: ${data.description}`);
            return null;
        }
        return data.result?.message_id ?? null;
    } catch (err) { logger.error("sendMessage failed:", err); return null; }
}

export async function editMessage(
    token: string, chatId: number, messageId: number, text: string,
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<boolean> {
    const body: Record<string, unknown> = {
        chat_id: chatId, message_id: messageId, text, ...(parseMode ? { parse_mode: parseMode } : {}),
    };
    try {
        const res = await fetch(`${BASE}${token}/editMessageText`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; description?: string; parameters?: { retry_after?: number } };
        if (!data.ok) {
            const desc = data.description ?? "";
            if (desc.includes("message is not modified")) return true;
            if (desc.includes("message to edit not found")) return false;
            const secs = retryAfterSecs(desc) || data.parameters?.retry_after;
            if (secs) {
                logger.warn(`editMessage: rate limited, waiting ${secs}s`);
                await new Promise((r) => setTimeout(r, secs * 1000));
                return editMessage(token, chatId, messageId, text, parseMode);
            }
            logger.error("editMessage failed:", desc);
            return false;
        }
        return true;
    } catch (err) { logger.error("editMessage error:", err); return false; }
}

export async function sendMessageWithInlineKeyboard(
    token: string, chatId: number, text: string, keyboard: any[][],
    parseMode: "MarkdownV2" | "HTML" | "Markdown" | "" = ""
): Promise<number | null> {
    const body: Record<string, unknown> = {
        chat_id: chatId, text,
        reply_markup: JSON.stringify({ inline_keyboard: keyboard }),
        ...(parseMode ? { parse_mode: parseMode } : {}),
    };
    try {
        const res = await fetch(`${BASE}${token}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; result?: { message_id: number }; description?: string };
        if (!data.ok) { logger.error(`sendMessageWithInlineKeyboard rejected: ${data.description}`); return null; }
        return data.result?.message_id ?? null;
    } catch (err) { logger.error("sendMessageWithInlineKeyboard failed:", err); return null; }
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<boolean> {
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) body["text"] = text;
    try {
        const res = await fetch(`${BASE}${token}/answerCallbackQuery`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        if (!data.ok) { logger.error(`answerCallbackQuery rejected: ${data.description}`); return false; }
        return true;
    } catch (err) { logger.error("answerCallbackQuery failed:", err); return false; }
}

export async function editMessageReplyMarkup(token: string, chatId: number, messageId: number, keyboard?: any[][]): Promise<boolean> {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId };
    if (keyboard) body["reply_markup"] = JSON.stringify({ inline_keyboard: keyboard });
    try {
        const res = await fetch(`${BASE}${token}/editMessageReplyMarkup`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        if (!data.ok) { logger.error("editMessageReplyMarkup failed:", data.description ?? ""); return false; }
        return true;
    } catch (err) { logger.error("editMessageReplyMarkup error:", err); return false; }
}

export async function deleteMessage(token: string, chatId: number, messageId: number): Promise<boolean> {
    try {
        const res = await fetch(`${BASE}${token}/deleteMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        if (!data.ok) { logger.error(`deleteMessage rejected: ${data.description}`); return false; }
        return true;
    } catch (err) { logger.error("deleteMessage failed:", err); return false; }
}

/**
 * Get file path from Telegram server.
 * Use this to download voice messages, photos, documents, etc.
 */
export async function getFile(token: string, fileId: string): Promise<{ file_path: string } | null> {
    try {
        const res = await fetch(`${BASE}${token}/getFile`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_id: fileId }),
        });
        const data = await res.json() as { ok: boolean; result?: { file_path: string }; description?: string };
        if (!data.ok) { logger.error(`getFile rejected: ${data.description}`); return null; }
        return data.result ?? null;
    } catch (err) { logger.error("getFile failed:", err); return null; }
}

/**
 * Download a file from Telegram servers.
 * Returns the file content as Uint8Array.
 */
export async function downloadFile(token: string, filePath: string): Promise<Uint8Array | null> {
    try {
        const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
        if (!res.ok) {
            logger.error(`downloadFile failed: ${res.status} ${res.statusText}`);
            return null;
        }
        return new Uint8Array(await res.arrayBuffer());
    } catch (err) { logger.error("downloadFile error:", err); return null; }
}
