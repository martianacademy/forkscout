// src/channels/telegram/message-handler.ts — handleMessage, handleCallbackQuery, handleDeniedUser

import type { AppConfig } from "@/config.ts";
import type { Message, Update } from "@grammyjs/types";
import { sendMessage, sendMessageWithInlineKeyboard, answerCallbackQuery, editMessageReplyMarkup, setMessageReaction } from "@/channels/telegram/api.ts";
import { compileTelegramMessage } from "@/channels/telegram/compile-message.ts";
import { streamReply } from "@/channels/telegram/stream-reply.ts";
import { buildChatHistory } from "@/channels/semantic-store.ts";
import { getRole, getVaultOwnerIds, addRuntimeAllowed, addRuntimeAdmin } from "@/channels/telegram/auth-helpers.ts";
import { loadRequests, saveRequests, upsertRequest, updateRequestStatus, addToAuthAllowList, type ApprovedRole } from "@/channels/telegram/access-requests.ts";
import { log } from "@/logs/logger.ts";

const logger = log("telegram/message-handler");

export async function handleMessage(config: AppConfig, token: string, chatId: number, rawMsg: Message, role: "owner" | "admin" | "user" = "user", abortSignal?: AbortSignal): Promise<void> {
    const sessionKey = `telegram-${chatId}`;
    const compiledMsg = compileTelegramMessage(rawMsg);
    await setMessageReaction(token, chatId, rawMsg.message_id, "👀").catch(() => { });
    const rawContent = typeof compiledMsg.content === "string" ? compiledMsg.content : JSON.stringify(compiledMsg.content);
    const roleTag = role === "owner" ? "OWNER" : role === "admin" ? "ADMIN" : "USER";
    const currentContent = `[${roleTag}] ${rawContent}`;
    const chatHistory = buildChatHistory(sessionKey);
    await streamReply(token, config, sessionKey, chatId, rawMsg, currentContent, chatHistory, role, abortSignal);
}

export async function handleCallbackQuery(config: AppConfig, token: string, cb: NonNullable<Update["callback_query"]>): Promise<void> {
    const cbUserId = cb.from.id;
    const cbChatId = cb.message?.chat.id ?? cbUserId;
    const cbMessageId = cb.message?.message_id;
    const cbRole = getRole(cbUserId, config);
    if (cbRole !== "owner") { await answerCallbackQuery(token, cb.id, "⛔ Owners only."); return; }
    const [action, rawId] = cb.data!.split(":");
    const targetId = parseInt(rawId, 10);
    if (isNaN(targetId)) { await answerCallbackQuery(token, cb.id, "⚠️ Invalid user ID."); return; }
    try {
        if (action === "allow_user" || action === "allow_admin") {
            const role: ApprovedRole = action === "allow_admin" ? "admin" : "user";
            const requests = loadRequests();
            const req = requests.find((r) => r.userId === targetId);
            if (role === "admin") { addRuntimeAdmin(targetId); addToAuthAllowList(targetId, "admin"); }
            else { addRuntimeAllowed(targetId); addToAuthAllowList(targetId, "user"); }
            if (req) {
                saveRequests(updateRequestStatus(requests, targetId, "approved", cbUserId, role));
                await sendMessage(token, req.chatId, "✅ Your access request has been approved!").catch(() => { });
            }
            const name = req ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`) : `User ${targetId}`;
            await answerCallbackQuery(token, cb.id, `✅ ${name} approved as ${role}`);
            if (cbMessageId) await editMessageReplyMarkup(token, cbChatId, cbMessageId);
        } else if (action === "deny") {
            const requests = loadRequests();
            const req = requests.find((r) => r.userId === targetId);
            if (req) {
                saveRequests(updateRequestStatus(requests, targetId, "denied", cbUserId));
                await sendMessage(token, req.chatId, "⛔ Your access request was denied.").catch(() => { });
            }
            const name = req ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`) : `User ${targetId}`;
            await answerCallbackQuery(token, cb.id, `⛔ ${name} denied`);
            if (cbMessageId) await editMessageReplyMarkup(token, cbChatId, cbMessageId);
        } else { await answerCallbackQuery(token, cb.id, "Unknown action."); }
    } catch (err) {
        logger.error("Callback action error:", err);
        await answerCallbackQuery(token, cb.id, "⚠️ Error processing action.");
    }
}

export async function handleDeniedUser(config: AppConfig, token: string, chatId: number, userId: number, username: string | null, firstName: string | null): Promise<void> {
    logger.warn(`Unauthorized userId ${userId} (chatId ${chatId})`);
    const requests = loadRequests();
    const existing = requests.find((r) => r.userId === userId);
    if (!existing) {
        saveRequests(upsertRequest(requests, { userId, chatId, username, firstName }));
        const d = firstName ? `${firstName}${username ? ` (@${username})` : ""}` : username ? `@${username}` : `User ${userId}`;
        const adminMsg = `🔔 <b>New access request</b>\n👤 <b>Name:</b> ${d}\n🆔 <b>userId:</b> <code>${userId}</code>\n💬 <b>chatId:</b> <code>${chatId}</code>\n${username ? `🔗 <b>username:</b> @${username}\n` : ""}`;
        const buttons = [[{ text: "✅ Allow (user)", callback_data: `allow_user:${userId}` }, { text: "👑 Allow (admin)", callback_data: `allow_admin:${userId}` }, { text: "❌ Deny", callback_data: `deny:${userId}` }]];
        for (const ownerId of getVaultOwnerIds()) { await sendMessageWithInlineKeyboard(token, ownerId, adminMsg, buttons, "HTML").catch(() => { }); }
        await sendMessage(token, chatId, `⛔ You're not on the allowlist yet.\n\nYour request has been sent to the admin.`);
    } else if (existing.status === "pending") {
        await sendMessage(token, chatId, `⏳ Your access request is still pending.`);
    } else if (existing.status === "denied") {
        await sendMessage(token, chatId, `⛔ Your access request was denied by the admin.`);
    } else { await sendMessage(token, chatId, `⛔ You are not authorized to use this bot.`); }
}
