// src/tools/telegram_message.ts
// Allows the agent to proactively send messages to Telegram chats.
// Used by self-cron jobs, background tasks, or any time the agent
// needs to notify a user without being in an active conversation.

import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "@/config.ts";
import { sendMessage } from "@/channels/telegram/api.ts";
import { mdToHtml, splitMessage, stripHtml } from "@/channels/telegram/format.ts";
import { log } from "@/logs/logger.ts";

export const IS_BOOTSTRAP_TOOL = false;

const logger = log("tool:telegram_message");

export const telegram_message_tools = tool({
    description:
        "Send a message to a Telegram chat. Use this to proactively notify users — from cron jobs, " +
        "background tasks, or any time you need to reach someone without waiting for them to message you first. " +
        "Actions: send (send to a specific chat_id), send_to_owners (send to all configured owner user IDs).",
    inputSchema: z.object({
        action: z.enum(["send", "send_to_owners"]).describe(
            "send = message a specific chat_id | send_to_owners = message all ownerUserIds from config",
        ),
        chat_id: z.number().optional().describe(
            "Telegram chat ID to send to. Required for action='send'. " +
            "Use a positive integer for users/groups. Get it from @userinfobot or from activity logs.",
        ),
        text: z.string().describe("Message text. Markdown is supported (bold, italic, code, links)."),
    }),
    execute: async (input) => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return { success: false, error: "TELEGRAM_BOT_TOKEN is not set" };

        const config = getConfig();

        const chatIds: number[] = input.action === "send_to_owners"
            ? config.telegram.ownerUserIds
            : input.chat_id !== undefined
                ? [input.chat_id]
                : [];

        if (chatIds.length === 0) {
            return {
                success: false,
                error: input.action === "send_to_owners"
                    ? "No ownerUserIds configured in telegram config"
                    : "chat_id is required for action='send'",
            };
        }

        const html = mdToHtml(input.text);
        const results: Array<{ chatId: number; messageId: number | null; ok: boolean }> = [];

        for (const chatId of chatIds) {
            let sent = false;
            for (const chunk of splitMessage(html)) {
                const msgId = await sendMessage(token, chatId, chunk, "HTML");
                if (msgId === null) {
                    // HTML rejected — fallback to plain text
                    logger.warn(`HTML rejected for chat ${chatId}, retrying as plain text`);
                    await sendMessage(token, chatId, stripHtml(chunk));
                    sent = true;
                } else {
                    sent = true;
                    results.push({ chatId, messageId: msgId, ok: true });
                }
            }
            if (!sent) {
                results.push({ chatId, messageId: null, ok: false });
            }
        }

        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) {
            logger.warn(`telegram_message: ${failed.length} delivery failure(s)`, failed);
        }

        return {
            success: failed.length === 0,
            sent: results.filter((r) => r.ok).map((r) => r.chatId),
            failed: failed.map((r) => r.chatId),
        };
    },
});
