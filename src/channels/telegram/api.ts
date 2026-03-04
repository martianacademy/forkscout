// src/channels/telegram/api.ts — Telegram Bot API (barrel + management helpers)
// Core messaging: api-core.ts | Media: api-media.ts

export {
    sendMessage, editMessage, sendMessageWithInlineKeyboard,
    answerCallbackQuery, editMessageReplyMarkup, deleteMessage,
} from "@/channels/telegram/api-core.ts";

export {
    sendPhoto, sendDocument, sendVoice, sendAudio,
    sendVideo, sendAnimation, sendLocation, sendPoll,
} from "@/channels/telegram/api-media.ts";

import { log } from "@/logs/logger.ts";
import { BASE } from "@/channels/telegram/api-core.ts";

const logger = log("telegram/api");

export async function sendTyping(token: string, chatId: number): Promise<void> {
    try {
        await fetch(`${BASE}${token}/sendChatAction`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, action: "typing" }),
        });
    } catch { /* best-effort */ }
}

export async function setMessageReaction(token: string, chatId: number, messageId: number, emoji: string): Promise<boolean> {
    if (!token || !chatId || !messageId || !emoji) {
        logger.warn(`setMessageReaction skipped: invalid args chatId=${chatId} msgId=${messageId}`);
        return false;
    }
    try {
        const res = await fetch(`${BASE}${token}/setMessageReactions`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        if (!data.ok) {
            // "Not Found" = message was deleted before reaction — expected, not an error
            if (data.description?.includes("Not Found")) return false;
            logger.warn(`setMessageReaction rejected: ${data.description}`);
            return false;
        }
        return true;
    } catch (err) { logger.error("setMessageReaction failed:", err); return false; }
}

export async function setMyCommands(token: string, commands: { command: string; description: string }[], scope: any): Promise<boolean> {
    try {
        const res = await fetch(`${BASE}${token}/setMyCommands`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commands, scope }),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        if (!data.ok) { logger.error(`setMyCommands rejected: ${data.description}`); return false; }
        return true;
    } catch (err) { logger.error("setMyCommands failed:", err); return false; }
}


