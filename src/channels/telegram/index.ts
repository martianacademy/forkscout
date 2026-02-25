// src/channels/telegram/index.ts — Telegram bot channel
import type { AppConfig } from "@/config.ts";
import { getConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { runAgent } from "@/agent/index.ts";
import { sendMessage, sendMessageWithInlineKeyboard, answerCallbackQuery, editMessageReplyMarkup, sendTyping } from "@/channels/telegram/api.ts";
import { log } from "@/logs/logger.ts";
import { encode } from "gpt-tokenizer";
import { loadHistory, saveHistory } from "@/channels/chat-store.ts";
import { mdToHtml, splitMessage, stripHtml } from "@/channels/telegram/format.ts";
import { compressIfLong } from "@/utils/extractive-summary.ts";
import type { ModelMessage } from "ai";
import {
    loadRequests,
    saveRequests,
    upsertRequest,
    updateRequestStatus,
    addToAuthAllowList,
    type ApprovedRole,
} from "@/channels/telegram/access-requests.ts";

const logger = log("telegram");

/** Per-chat conversation history: chatId → ModelMessage[] */
const chatHistories = new Map<number, ModelMessage[]>();

/** Per-chat sequential queue: ensures messages are processed one at a time per chat */
const chatQueues = new Map<number, Promise<void>>();

/** Per-user rate limit tracking: userId → { count, windowStart } */
const rateLimiter = new Map<number, { count: number; windowStart: number }>();

/**
 * Runtime allowlist — seeded from config.telegram.allowedUserIds at startup.
 * Grows when an owner uses /allow <userId>. Survives without restart.
 */
let runtimeAllowedUsers = new Set<number>();

/**
 * Runtime owner set — seeded from config.telegram.ownerUserIds at startup.
 * Grows when an owner uses /allow <userId> admin. Survives without restart.
 */
let runtimeOwnerUsers = new Set<number>();

/** True when both ownerUserIds and allowedUserIds are empty in config (dev mode). */
let devMode = false;

/**
 * Returns true if the user is within their rate limit window, false if exceeded.
 * Owners are never rate-limited.
 */
function checkRateLimit(userId: number, limitPerMin: number): boolean {
    if (limitPerMin <= 0) return true;
    const now = Date.now();
    const entry = rateLimiter.get(userId) ?? { count: 0, windowStart: now };
    if (now - entry.windowStart > 60_000) {
        rateLimiter.set(userId, { count: 1, windowStart: now });
        return true;
    }
    if (entry.count >= limitPerMin) return false;
    entry.count++;
    rateLimiter.set(userId, entry);
    return true;
}

/**
 * Returns the role of a user: 'owner' | 'user' | 'denied'.
 * devMode (both lists empty in config) = everyone is owner.
 * runtimeAllowedUsers is seeded from config and updated by /allow without restart.
 */
function getRole(userId: number, config: AppConfig): 'owner' | 'user' | 'denied' {
    if (devMode) return 'owner';
    if (config.telegram.ownerUserIds.includes(userId) || runtimeOwnerUsers.has(userId)) return 'owner';
    if (runtimeAllowedUsers.has(userId)) return 'user';
    return 'denied';
}

/**
 * Count tokens for a message by serialising its content to a string.
 * Tool call inputs and tool results are serialised — not flat-estimated —
 * because they can be arbitrarily large (web pages, shell output, file reads).
 */
function countMessageTokens(msg: ModelMessage): number {
    if (typeof msg.content === "string") {
        return encode(msg.content).length;
    }
    if (Array.isArray(msg.content)) {
        return msg.content.reduce((sum, part: any) => {
            // text block
            if (part.type === "text" && typeof part.text === "string") {
                return sum + encode(part.text).length;
            }
            // tool call — serialise the input args
            if (part.type === "tool-call") {
                const s = typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? "");
                return sum + encode(s).length;
            }
            // tool result — serialise the output (can be huge: web pages, shell output)
            // Note: AI SDK uses 'output' field, not 'result'
            if (part.type === "tool-result") {
                const s = typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? "");
                return sum + encode(s).length;
            }
            // images / files / unknown — flat 512 token estimate
            return sum + 512;
        }, 0);
    }
    return 0;
}

/**
 * Cap individual tool-result parts to maxTokens tokens.
 * When a result exceeds the limit, extractive summarisation is used —
 * the most informative sentences are kept in original order.
 * This preserves meaning instead of blindly truncating.
 */
function capToolResults(history: ModelMessage[], maxTokens: number, maxSentences: number): ModelMessage[] {
    // rough char budget: ~4 chars per token
    const maxChars = maxTokens * 4;
    return history.map((msg): ModelMessage => {
        if (!Array.isArray(msg.content)) return msg;
        const capped = msg.content.map((part: any) => {
            if (part.type !== "tool-result") return part;
            // Note: AI SDK uses 'output' field, not 'result'
            const raw: string = typeof part.output === "string" ? part.output : JSON.stringify(part.output ?? "");
            if (encode(raw).length <= maxTokens) return part;
            // Use extractive summarisation — keeps the most informative sentences
            const sentences = maxSentences;
            const compressed = compressIfLong(raw, maxChars, sentences);
            return { ...part, output: compressed };
        });
        return { ...msg, content: capped } as ModelMessage;
    });
}

/**
 * Trim history so it fits within HISTORY_TOKEN_BUDGET.
 * Removes oldest messages first, never removes the last exchange.
 */
function trimHistory(history: ModelMessage[], tokenBudget: number): ModelMessage[] {
    let total = history.reduce((sum, m) => sum + countMessageTokens(m), 0);
    let trimmed = [...history];

    // Keep removing the oldest message until within budget (retain at least last 2)
    while (total > tokenBudget && trimmed.length > 2) {
        const removed = trimmed.shift()!;
        total -= countMessageTokens(removed);
    }

    if (trimmed.length < history.length) {
        logger.info(`History trimmed: ${history.length} → ${trimmed.length} messages (${total} tokens)`);
    }

    return trimmed;
}

export default {
    name: "telegram",
    start,
} satisfies Channel;

async function start(config: AppConfig) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");

    // Seed runtime auth state from config (updated live by /allow without restart)
    devMode = config.telegram.ownerUserIds.length === 0 && config.telegram.allowedUserIds.length === 0;
    runtimeAllowedUsers = new Set(config.telegram.allowedUserIds);
    runtimeOwnerUsers = new Set(config.telegram.ownerUserIds);

    logger.info("Starting long-poll...");

    let offset = 0;

    while (true) {
        try {
            const updates = await getUpdates(token, offset, config.telegram.pollingTimeout);

            for (const update of updates) {
                offset = update.update_id + 1;

                // --- Inline button presses (callback_query) ---
                if (update.callback_query) {
                    const cb = update.callback_query;
                    const cbUserId = cb.from.id;
                    const cbChatId = cb.message?.chat.id ?? cbUserId;
                    const cbMessageId = cb.message?.message_id;
                    const cbRole = getRole(cbUserId, config);

                    if (cbRole !== 'owner') {
                        await answerCallbackQuery(token, cb.id, "⛔ Owners only.");
                    } else {
                        const [action, rawId] = cb.data.split(":");
                        const targetId = parseInt(rawId, 10);

                        if (!isNaN(targetId)) {
                            try {
                                if (action === "allow_user" || action === "allow_admin") {
                                    const role: ApprovedRole = action === "allow_admin" ? "admin" : "user";
                                    const requests = loadRequests();
                                    const req = requests.find((r) => r.userId === targetId);

                                    if (role === "admin") {
                                        runtimeOwnerUsers.add(targetId);
                                        addToAuthAllowList(targetId, "admin");
                                    } else {
                                        runtimeAllowedUsers.add(targetId);
                                        addToAuthAllowList(targetId, "user");
                                    }

                                    if (req) {
                                        saveRequests(updateRequestStatus(requests, targetId, "approved", cbUserId, role));
                                        await sendMessage(token, req.chatId, "✅ Your access request has been approved! You can now use the bot.").catch(() => { });
                                    }

                                    const name = req
                                        ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`)
                                        : `User ${targetId}`;
                                    await answerCallbackQuery(token, cb.id, `✅ ${name} approved as ${role}`);

                                    // Remove buttons from original notification
                                    if (cbMessageId) {
                                        await editMessageReplyMarkup(token, cbChatId, cbMessageId, null);
                                    }

                                } else if (action === "deny") {
                                    const requests = loadRequests();
                                    const req = requests.find((r) => r.userId === targetId);

                                    if (req) {
                                        saveRequests(updateRequestStatus(requests, targetId, "denied", cbUserId));
                                        await sendMessage(token, req.chatId, "⛔ Your access request has been reviewed and denied.").catch(() => { });
                                    }

                                    const name = req
                                        ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`)
                                        : `User ${targetId}`;
                                    await answerCallbackQuery(token, cb.id, `⛔ ${name} denied`);

                                    // Remove buttons from original notification
                                    if (cbMessageId) {
                                        await editMessageReplyMarkup(token, cbChatId, cbMessageId, null);
                                    }
                                } else {
                                    await answerCallbackQuery(token, cb.id, "Unknown action.");
                                }
                            } catch (err: any) {
                                logger.error("Callback action error:", err);
                                await answerCallbackQuery(token, cb.id, "⚠️ Error processing action.");
                            }
                        } else {
                            await answerCallbackQuery(token, cb.id, "⚠️ Invalid user ID.");
                        }
                    }
                    continue;
                }

                // --- Regular messages ---
                const msg = update.message;
                if (!msg?.text) continue;

                const chatId = msg.chat.id;
                const userId = msg.from?.id ?? chatId;
                const username = msg.from?.username ?? null;
                const firstName = msg.from?.first_name ?? null;
                const text = msg.text;

                // /start — always allowed, before auth
                if (text === "/start") {
                    await sendMessage(token, chatId, `👋 Hi! I'm ${config.agent.name}. How can I help you?`);
                    continue;
                }

                // Layer 1: Role-based auth
                const role = getRole(userId, config);

                if (role === 'denied') {
                    logger.warn(`Unauthorized userId ${userId} (chatId ${chatId}) username=${username ?? 'none'} — rejected`);
                    const requests = loadRequests();
                    const existing = requests.find((r) => r.userId === userId);

                    if (!existing) {
                        // First contact — save request, notify all owners once
                        const updated = upsertRequest(requests, { userId, chatId, username, firstName });
                        saveRequests(updated);

                        const displayName = firstName
                            ? `${firstName}${username ? ` (@${username})` : ""}`
                            : username ? `@${username}` : `User ${userId}`;
                        const adminMsg =
                            `🔔 <b>New access request</b>\n` +
                            `👤 <b>Name:</b> ${displayName}\n` +
                            `🆔 <b>userId:</b> <code>${userId}</code>\n` +
                            `💬 <b>chatId:</b> <code>${chatId}</code>\n` +
                            (username ? `🔗 <b>username:</b> @${username}\n` : "");
                        const buttons = [
                            [
                                { text: "✅ Allow (user)", callback_data: `allow_user:${userId}` },
                                { text: "👑 Allow (admin)", callback_data: `allow_admin:${userId}` },
                                { text: "❌ Deny", callback_data: `deny:${userId}` },
                            ]
                        ];
                        for (const ownerId of config.telegram.ownerUserIds) {
                            await sendMessageWithInlineKeyboard(token, ownerId, adminMsg, buttons, "HTML").catch(() => { });
                        }
                        await sendMessage(token, chatId, `⛔ You're not on the allowlist yet.\n\nYour request has been sent to the admin. You'll be notified when it's reviewed.`);
                    } else if (existing.status === "pending") {
                        await sendMessage(token, chatId, `⏳ Your access request is still pending admin review. You'll be notified once it's approved.`);
                    } else if (existing.status === "denied") {
                        await sendMessage(token, chatId, `⛔ Your access request was denied by the admin.`);
                    } else {
                        await sendMessage(token, chatId, `⛔ You are not authorized to use this bot.`);
                    }
                    continue;
                }

                // Owner commands (/allow, /deny, /pending, /requests, /whoami)
                if (text.startsWith("/") && role === 'owner') {
                    await handleOwnerCommand(token, chatId, userId, text).catch(async (err) => {
                        logger.error("Owner command error:", err);
                        await sendMessage(token, chatId, `⚠️ Command error: <code>${String(err?.message ?? err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`, "HTML").catch(() => { });
                    });
                    continue;
                }

                // Silently ignore unknown commands for non-owners
                if (text.startsWith("/")) continue;

                // Layer 2: Input length cap
                const maxLen = config.telegram.maxInputLength;
                if (maxLen > 0 && text.length > maxLen) {
                    await sendMessage(token, chatId, `⚠️ Message too long (max ${maxLen} characters).`);
                    continue;
                }

                // Layer 3: Rate limiting (owners bypass)
                if (role !== 'owner' && !checkRateLimit(userId, config.telegram.rateLimitPerMinute)) {
                    logger.warn(`Rate limit exceeded for userId ${userId}`);
                    await sendMessage(token, chatId, "⏳ Too many messages. Please wait a moment.");
                    continue;
                }

                logger.info(`[${role}] ${userId}/${chatId}: ${text.slice(0, 80)}`);

                // Layer 4: Tool restrictions by role
                const excludeTools = role !== 'owner' ? config.telegram.ownerOnlyTools : [];

                // Queue per chat — serialises concurrent messages, never races
                const prev = chatQueues.get(chatId) ?? Promise.resolve();
                const next = prev.then(() =>
                    handleMessage(config, token, chatId, userId, text, excludeTools).catch((err) =>
                        logger.error("Handler error:", err)
                    )
                );
                chatQueues.set(chatId, next);
            }
        } catch (err) {
            logger.error("Poll error:", err);
            await sleep(3000);
        }
    }
}

async function handleMessage(
    config: AppConfig,
    token: string,
    chatId: number,
    userId: number,
    text: string,
    excludeTools: string[]
) {
    // Send typing indicator while agent is running (Telegram clears it after ~5s)
    const typingInterval = setInterval(() => sendTyping(token, chatId), 4000);
    void sendTyping(token, chatId);

    // Load history: in-memory cache with disk fallback (survives restart)
    const sessionKey = `telegram-${chatId}`;
    if (!chatHistories.has(chatId)) {
        chatHistories.set(chatId, loadHistory(sessionKey));
    }
    const history = trimHistory(chatHistories.get(chatId)!, config.telegram.historyTokenBudget);

    try {
        const result = await runAgent(config, {
            userMessage: text,
            chatHistory: history,
            excludeTools,
            meta: { channel: "telegram", chatId },
        });
        clearInterval(typingInterval);

        // Persist updated history: cap large tool results first, then trim by age
        const capped = capToolResults([...history, ...result.responseMessages], config.telegram.maxToolResultTokens, config.telegram.maxSentencesPerToolResult);
        const updated = trimHistory(capped, config.telegram.historyTokenBudget);
        chatHistories.set(chatId, updated);
        saveHistory(sessionKey, updated);

        if (result.text) {
            const html = mdToHtml(result.text);
            for (const chunk of splitMessage(html)) {
                const msgId = await sendMessage(token, chatId, chunk, "HTML");
                if (msgId === null) {
                    // HTML rejected by Telegram — fallback to plain text
                    logger.warn("HTML send failed, retrying as plain text");
                    await sendMessage(token, chatId, stripHtml(chunk));
                }
            }
        }
    } catch (err: any) {
        clearInterval(typingInterval);
        logger.error("Agent error:", err.message, err);
        await sendMessage(token, chatId, `⚠️ <b>Error:</b> <code>${String(err.message).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`, "HTML");
    }
}

async function handleOwnerCommand(token: string, chatId: number, ownerUserId: number, text: string) {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1] ?? "";

    // /restart — blue-green restart: typecheck → spawn → verify alive → swap
    if (cmd === "/restart") {
        await sendMessage(token, chatId, "🔄 Checking code before restart...");

        // Step 1: typecheck
        const tsc = Bun.spawnSync(["bun", "run", "typecheck"], { cwd: process.cwd() });
        if (tsc.exitCode !== 0) {
            const output = (new TextDecoder().decode(tsc.stdout) + new TextDecoder().decode(tsc.stderr)).trim().slice(0, 1500);
            await sendMessage(
                token, chatId,
                `❌ <b>Restart aborted — typecheck failed.</b>\n<pre>${output}</pre>`,
                "HTML"
            );
            return;
        }

        await sendMessage(token, chatId, "✅ Typecheck passed. Spawning new instance...");

        // Step 2: spawn new process
        const child = Bun.spawn(["bun", "run", "src/index.ts"], {
            cwd: process.cwd(),
            stdio: ["ignore", "ignore", "ignore"],
            detached: true,
        });

        // Step 3: wait 6s and check if it's still alive
        await new Promise((r) => setTimeout(r, 6000));

        if (child.exitCode !== null) {
            // New process already died — startup failure (bad API key, config error, etc.)
            await sendMessage(
                token, chatId,
                `❌ <b>Restart aborted — new instance crashed at startup</b> (exit ${child.exitCode}).\nThe current bot is still running.\n\n🔍 Asking the agent to self-diagnose...`,
                "HTML"
            );

            // Feed the failure back into the agent — it will diagnose, fix, and retry
            const diagTask =
                `SYSTEM: Self-restart just failed. The new instance crashed at startup with exit code ${child.exitCode}.\n` +
                `The current process is still running.\n\n` +
                `Your job:\n` +
                `1. Check recent logs: tail -50 .forkscout/activity.log\n` +
                `2. Check for startup errors: bun run src/index.ts 2>&1 | head -40 (kill after 5s)\n` +
                `3. Identify the root cause (broken code, missing env var, bad config, MCP failure, etc.)\n` +
                `4. Fix it\n` +
                `5. Run bun run typecheck to verify\n` +
                `6. Send /restart to try again\n\n` +
                `Do not wait for instructions. Start diagnosing now.`;

            // Fire async — don't block the command handler
            runAgent(getConfig(), {
                userMessage: diagTask,
                meta: { channel: "telegram", chatId },
            }).then(async (result) => {
                if (result.text) {
                    const html = mdToHtml(result.text);
                    for (const chunk of splitMessage(html)) {
                        await sendMessage(token, chatId, chunk, "HTML").catch(() =>
                            sendMessage(token, chatId, stripHtml(chunk))
                        );
                    }
                }
            }).catch((err) => {
                logger.error("Self-diagnosis agent error:", err);
            });

            return;
        }

        // Step 4: new process is healthy — hand off and exit
        await sendMessage(token, chatId, "✅ New instance is healthy. Handing off now.");
        process.exit(0);
        return;
    }

    // /whoami — debug: show userId, chatId, role
    if (cmd === "/whoami") {
        await sendMessage(
            token,
            chatId,
            `🛡️ <b>You are an owner.</b>\n🆔 userId: <code>${ownerUserId}</code>\n💬 chatId: <code>${chatId}</code>`,
            "HTML"
        );
        return;
    }

    // /allow <userId> — approve a pending request and add to allowlist
    if (cmd === "/allow") {
        const targetId = parseInt(arg, 10);
        if (isNaN(targetId)) {
            await sendMessage(token, chatId, "⚠️ Usage: <code>/allow &lt;userId&gt;</code>", "HTML");
            return;
        }
        const requests = loadRequests();
        const req = requests.find((r) => r.userId === targetId);

        // Add to runtime set (immediate effect) + persist to auth.json
        runtimeAllowedUsers.add(targetId);
        addToAuthAllowList(targetId);

        if (req) {
            saveRequests(updateRequestStatus(requests, targetId, "approved", ownerUserId));
            await sendMessage(token, req.chatId, "✅ Your access request has been approved! You can now use the bot.").catch(() => { });
        }

        const name = req
            ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`)
            : `User ${targetId}`;
        await sendMessage(token, chatId, `✅ <b>${name}</b> (<code>${targetId}</code>) approved and added to allowlist.`, "HTML");
        return;
    }

    // /deny <userId> — deny a pending request
    if (cmd === "/deny") {
        const targetId = parseInt(arg, 10);
        if (isNaN(targetId)) {
            await sendMessage(token, chatId, "⚠️ Usage: <code>/deny &lt;userId&gt;</code>", "HTML");
            return;
        }
        const requests = loadRequests();
        const req = requests.find((r) => r.userId === targetId);

        if (req) {
            saveRequests(updateRequestStatus(requests, targetId, "denied", ownerUserId));
            await sendMessage(token, req.chatId, "⛔ Your access request has been reviewed and denied.").catch(() => { });
        }

        const name = req
            ? (req.firstName ? `${req.firstName}${req.username ? ` (@${req.username})` : ""}` : `User ${targetId}`)
            : `User ${targetId}`;
        await sendMessage(token, chatId, `⛔ <b>${name}</b> (<code>${targetId}</code>) denied.`, "HTML");
        return;
    }

    // /pending — list requests waiting for review
    if (cmd === "/pending") {
        const requests = loadRequests();
        const pending = requests.filter((r) => r.status === "pending");
        if (pending.length === 0) {
            await sendMessage(token, chatId, "✅ No pending access requests.");
            return;
        }
        const lines = pending.map((r, i) => {
            const name = r.firstName
                ? `${r.firstName}${r.username ? ` (@${r.username})` : ""}`
                : r.username ? `@${r.username}` : `User ${r.userId}`;
            const date = new Date(r.requestedAt).toLocaleString();
            return (
                `${i + 1}. <b>${name}</b>\n` +
                `   🆔 userId: <code>${r.userId}</code> | 💬 chatId: <code>${r.chatId}</code>\n` +
                `   📅 ${date}\n` +
                `   /allow ${r.userId}  |  /deny ${r.userId}`
            );
        });
        await sendMessage(token, chatId, `📋 <b>Pending requests (${pending.length})</b>\n\n${lines.join("\n\n")}`, "HTML");
        return;
    }

    // /requests — show all requests with their status and role
    if (cmd === "/requests") {
        const requests = loadRequests();
        if (requests.length === 0) {
            await sendMessage(token, chatId, "No access requests yet.");
            return;
        }
        const statusEmoji: Record<string, string> = { pending: "\u23f3", approved: "\u2705", denied: "\u26d4" };
        const roleLabel = (r: { status: string; role?: string }) =>
            r.status === "approved" ? (r.role === "admin" ? " \ud83d\udee1\ufe0f admin" : " \ud83d\udc64 user") : "";
        const lines = requests.map((r) => {
            const name = r.firstName
                ? `${r.firstName}${r.username ? ` (@${r.username})` : ""}`
                : r.username ? `@${r.username}` : `User ${r.userId}`;
            return `${statusEmoji[r.status] ?? "\u2753"} <b>${name}</b> \u2014 <code>${r.userId}</code> \u2014 ${r.status}${roleLabel(r)}`;
        });
        await sendMessage(token, chatId, `📋 <b>All access requests (${requests.length})</b>\n\n${lines.join("\n")}`, "HTML");
        return;
    }

    // Unknown command — silently ignore (don't accidentally send to agent)
}

async function getUpdates(
    token: string,
    offset: number,
    timeout: number
): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=["message","callback_query"]`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok) return [];
    return data.result;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

interface TelegramUpdate {
    update_id: number;
    message?: {
        chat: { id: number };
        message_id?: number;
        text?: string;
        from?: { id: number; username?: string; first_name?: string };
    };
    callback_query?: {
        id: string;
        from: { id: number; username?: string; first_name?: string };
        message?: { chat: { id: number }; message_id: number };
        data: string;
    };
}
