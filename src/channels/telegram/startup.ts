// src/channels/telegram/startup.ts — Startup notifications and command registration

import type { AppConfig } from "@/config.ts";
import { getConfig } from "@/config.ts";
import { sendMessage, setMyCommands } from "@/channels/telegram/api.ts";
import { mdToHtml, splitMarkdown } from "@/channels/telegram/format.ts";
import { runAgent } from "@/agent/index.ts";
import { log } from "@/logs/logger.ts";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";

const logger = log("telegram/startup");

type RestartCtx = { reason?: string; continueTask?: string | null; restartedAt?: string };

function loadRestartContext(): RestartCtx | null {
    const f = resolve(process.cwd(), ".agents", "restart-context.json");
    if (!existsSync(f)) return null;
    try {
        const ctx = JSON.parse(readFileSync(f, "utf-8")) as RestartCtx;
        unlinkSync(f);
        logger.info(`Restart context loaded: ${JSON.stringify(ctx)}`);
        return ctx;
    } catch {
        logger.warn("Failed to read restart-context.json — ignoring");
        return null;
    }
}

function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function autoContinueTask(token: string, ownerChatId: number, reason: string | undefined, continueTask: string): Promise<void> {
    logger.info(`Auto-continuing task after restart: "${continueTask}" (chat ${ownerChatId})`);
    setTimeout(async () => {
        try {
            const selfMessage = `[SELF-RESUME] I just restarted. Reason: ${reason ?? "unknown"}.\n\nTask to continue: ${continueTask}\n\nProceed now.`;
            const result = await runAgent(getConfig(), { userMessage: selfMessage, role: "self", meta: { channel: "telegram", chatId: ownerChatId } });
            if (result.text) {
                for (const chunk of splitMarkdown(result.text).map(mdToHtml)) {
                    await sendMessage(token, ownerChatId, chunk, "HTML").catch(() => { });
                }
            }
            logger.info(`Auto-continue task completed (${result.steps} steps)`);
        } catch (err) {
            logger.error(`Auto-continue task failed: ${err}`);
            await sendMessage(token, ownerChatId, `⚠️ Auto-continue task failed: ${err}`, "HTML").catch(() => { });
        }
    }, 3000);
}

export async function runStartup(token: string, _config: AppConfig, vaultOwnerIds: number[]): Promise<void> {
    const ctx = loadRestartContext();
    if (vaultOwnerIds.length > 0) {
        const restartReason = ctx?.reason ?? process.env.FORKSCOUT_RESTART_REASON;
        const continueTask = ctx?.continueTask;
        const msg = restartReason
            ? `✅ <b>Agent restarted.</b>\n<i>Reason: ${escHtml(restartReason)}</i>${continueTask ? `\n<i>Auto-continuing: ${escHtml(continueTask)}</i>` : ""}\n\nAgent is live. All systems normal.`
            : `🟢 <b>Agent is live.</b> All systems normal.`;
        logger.info(`Startup — notifying ${vaultOwnerIds.length} owner(s)`);
        for (const chatId of vaultOwnerIds) {
            await sendMessage(token, chatId, msg, "HTML").catch(() => { });
        }
        if (continueTask) {
            await autoContinueTask(token, vaultOwnerIds[0], restartReason, continueTask);
        }
    }

    const ownerCommands = [
        { command: "start", description: "Start the bot" },
        { command: "secret", description: "Manage encrypted secrets: store | list | delete | env | sync" },
        { command: "restart", description: "Safely restart the agent" },
        { command: "whoami", description: "Show your user ID and role" },
        { command: "allow", description: "Approve a pending access request" },
        { command: "deny", description: "Deny an access request" },
        { command: "pending", description: "List pending access requests" },
        { command: "requests", description: "Show all access requests" },
        { command: "backfill", description: "Re-index chat history embeddings for semantic search" },
    ];
    for (const ownerId of vaultOwnerIds) {
        await setMyCommands(token, ownerCommands, { type: "chat", chat_id: ownerId });
    }
    logger.info("Bot commands registered in Telegram menu (owner-scoped).");
}
