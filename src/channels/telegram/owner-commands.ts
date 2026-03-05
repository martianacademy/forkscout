// src/channels/telegram/owner-commands.ts — Owner slash commands and restart

import type { AppConfig } from "@/config.ts";
import { sendMessage, editMessage, deleteMessage } from "@/channels/telegram/api.ts";
import { mdToHtml, splitMarkdown, stripHtml } from "@/channels/telegram/format.ts";
import { runAgent } from "@/agent/index.ts";
import { getConfig } from "@/config.ts";
import { getVaultOwnerIds, addRuntimeAllowed } from "@/channels/telegram/auth-helpers.ts";
import { loadRequests, saveRequests, updateRequestStatus, addToAuthAllowList } from "@/channels/telegram/access-requests.ts";
import { sleep } from "@/channels/telegram/api-utils.ts";
import { log } from "@/logs/logger.ts";

const logger = log("telegram/owner-commands");

export async function handleOwnerCommand(token: string, chatId: number, ownerUserId: number, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1] ?? "";

    if (cmd === "/restart") { await handleRestart(token, chatId); return; }

    if (cmd === "/whoami") {
        await sendMessage(token, chatId, `🛡️ <b>You are an owner.</b>\n🆔 userId: <code>${ownerUserId}</code>\n💬 chatId: <code>${chatId}</code>`, "HTML");
        return;
    }

    if (cmd === "/allow") {
        const targetId = parseInt(arg, 10);
        if (isNaN(targetId)) { await sendMessage(token, chatId, "⚠️ Usage: <code>/allow &lt;userId&gt;</code>", "HTML"); return; }
        const requests = loadRequests();
        const req = requests.find((r) => r.userId === targetId);
        addRuntimeAllowed(targetId);
        addToAuthAllowList(targetId);
        if (req) {
            saveRequests(updateRequestStatus(requests, targetId, "approved", ownerUserId));
            await sendMessage(token, req.chatId, "✅ Your access request has been approved!").catch(() => { });
        }
        const name = req ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`) : `User ${targetId}`;
        await sendMessage(token, chatId, `✅ <b>${name}</b> (<code>${targetId}</code>) approved.`, "HTML");
        return;
    }

    if (cmd === "/deny") {
        const targetId = parseInt(arg, 10);
        if (isNaN(targetId)) { await sendMessage(token, chatId, "⚠️ Usage: <code>/deny &lt;userId&gt;</code>", "HTML"); return; }
        const requests = loadRequests();
        const req = requests.find((r) => r.userId === targetId);
        if (req) {
            saveRequests(updateRequestStatus(requests, targetId, "denied", ownerUserId));
            await sendMessage(token, req.chatId, "⛔ Your access request was denied.").catch(() => { });
        }
        const name = req ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`) : `User ${targetId}`;
        await sendMessage(token, chatId, `⛔ <b>${name}</b> (<code>${targetId}</code>) denied.`, "HTML");
        return;
    }

    if (cmd === "/pending") {
        const pending = loadRequests().filter((r) => r.status === "pending");
        if (!pending.length) { await sendMessage(token, chatId, "✅ No pending access requests."); return; }
        const lines = pending.map((r, i) => {
            const name = r.firstName ? `${r.firstName}${r.username ? ` (@${r.username})` : ""}` : r.username ? `@${r.username}` : `User ${r.userId}`;
            return `${i + 1}. <b>${name}</b>\n   🆔 userId: <code>${r.userId}</code>\n   /allow ${r.userId}  |  /deny ${r.userId}`;
        });
        await sendMessage(token, chatId, `📋 <b>Pending (${pending.length})</b>\n\n${lines.join("\n\n")}`, "HTML");
        return;
    }

    if (cmd === "/requests") {
        const all = loadRequests();
        if (!all.length) { await sendMessage(token, chatId, "No access requests yet."); return; }
        const se: Record<string, string> = { pending: "⏳", approved: "✅", denied: "❌" };
        const lines = all.map((r) => {
            const name = r.firstName ? `${r.firstName}${r.username ? ` (@${r.username})` : ""}` : r.username ? `@${r.username}` : `User ${r.userId}`;
            return `${se[r.status] ?? "❓"} <b>${name}</b> — <code>${r.userId}</code> — ${r.status}`;
        });
        await sendMessage(token, chatId, `📋 <b>All requests (${all.length})</b>\n\n${lines.join("\n")}`, "HTML");
        return;
    }

    // Unknown owner command — silently ignore
}

export async function handleRestart(token: string, chatId: number): Promise<void> {
    await sendMessage(token, chatId, "🔄 Checking code before restart...");
    const tsc = Bun.spawnSync(["bun", "run", "typecheck"], { cwd: process.cwd() });
    if (tsc.exitCode !== 0) {
        const output = (new TextDecoder().decode(tsc.stdout) + new TextDecoder().decode(tsc.stderr)).trim().slice(0, 1500);
        await sendMessage(token, chatId, `❌ <b>Restart aborted — typecheck failed.</b>\n<pre>${output}</pre>`, "HTML");
        return;
    }
    await sendMessage(token, chatId, "✅ Typecheck passed. Spawning new instance...");
    const child = Bun.spawn(["bun", "run", "src/index.ts"], { cwd: process.cwd(), stdio: ["ignore", "ignore", "ignore"], detached: true });
    await sleep(6000);
    if (child.exitCode !== null) {
        await sendMessage(token, chatId, `❌ <b>Restart failed</b> (exit ${child.exitCode}). Current bot still running.\n\nAsking agent to self-diagnose...`, "HTML");
        const diagTask = `SYSTEM: Self-restart failed (exit ${child.exitCode}). Check logs: tail -50 .agents/activity.log, find the root cause, fix it, run typecheck, then /restart.`;
        runAgent(getConfig(), { userMessage: diagTask, meta: { channel: "telegram", chatId } })
            .then(async (result) => {
                if (!result.text) return;
                for (const c of splitMarkdown(result.text).map(mdToHtml)) {
                    await sendMessage(token, chatId, c, "HTML").catch(() => sendMessage(token, chatId, stripHtml(c)));
                }
            }).catch((err) => logger.error("Self-diagnosis failed:", err));
        return;
    }
    await sendMessage(token, chatId, "✅ New instance healthy. Handing off now.");
    process.exit(0);
}
