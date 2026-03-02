// src/channels/telegram/index.ts — Telegram bot channel

// ─────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────

import type { AppConfig } from "@/config.ts";
import { getConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { runAgent, streamAgent } from "@/agent/index.ts";
import {
    sendMessage,
    sendMessageWithInlineKeyboard,
    answerCallbackQuery,
    editMessageReplyMarkup,
    editMessage,
    deleteMessage,
    setMessageReaction,
    setMyCommands,
    sendTyping,
} from "@/channels/telegram/api.ts";
import { mdToHtml, splitMarkdown, stripHtml } from "@/channels/telegram/format.ts";
import { compileTelegramMessage } from "@/channels/telegram/compile-message.ts";
import { prepareHistory } from "@/channels/prepare-history.ts";
import { loadHistory, appendHistory, saveHistory } from "@/channels/chat-store.ts";
import { embedNewTurns } from "@/channels/history-embeddings.ts";
import { log } from "@/logs/logger.ts";
import { LOG_DIR } from "@/logs/activity-log.ts";
import type { ModelMessage } from "ai";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import type { Message, Update } from "@grammyjs/types";
import {
    loadRequests,
    saveRequests,
    upsertRequest,
    updateRequestStatus,
    addToAuthAllowList,
    type ApprovedRole,
} from "@/channels/telegram/access-requests.ts";
import { setSecret, listAliases, deleteSecret } from "@/secrets/vault.ts";
import { LLMError } from "@/llm/retry.ts";

// ─────────────────────────────────────────────
// Constants & module-level state
// ─────────────────────────────────────────────

const CHATS_DIR = resolve(LOG_DIR, "chats");
const logger = log("telegram");

/**
 * Parse owner user IDs from vault-stored env var.
 * populateEnvFromVault() at boot sets process.env.TELEGRAM_OWNER_IDS = JSON array string.
 * Falls back to empty array if missing or unparseable.
 */
function getVaultOwnerIds(): number[] {
    const raw = process.env.TELEGRAM_OWNER_IDS;
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((n: any) => typeof n === "number") : [];
    } catch {
        return [];
    }
}

// ─── Tool progress helpers ────────────────────────────────────────────────────

/** Human-readable label for each tool name. Falls back to the tool name itself. */
const TOOL_LABELS: Record<string, string> = {
    web_search: "Searching the web",
    web_broswer_tools: "Browsing",
    browse_web: "Browsing",
    navigate: "Navigating",
    read_file: "Reading file",
    write_file: "Writing file",
    list_dir: "Listing directory",
    run_shell_commands: "Running shell command",
    think_step_by_step: "Thinking",
    analyze_image: "Analyzing image",
    compress_text: "Compressing text",
};

/** Extracts the most meaningful short preview from a tool's input object. */
function toolInputPreview(input: unknown): string {
    if (!input || typeof input !== "object") return "";
    const i = input as Record<string, unknown>;
    const best = i.query ?? i.url ?? i.command ?? i.path ?? i.filePath ?? i.text ?? i.prompt ?? i.file_id;
    if (typeof best === "string") return best.slice(0, 100);
    return "";
}

/** Per-chat sequential queue — one message processed at a time per chat, no races. */
const chatQueues = new Map<number, Promise<void>>();

/** Per-chat abort controllers — abort the previous task when a new message arrives. */
const chatAbortControllers = new Map<number, AbortController>();

/** Per-user rate limit tracking: userId → { count, windowStart } */
const rateLimiter = new Map<number, { count: number; windowStart: number }>();

/**
 * Runtime allowlist — seeded from config.telegram.allowedUserIds at startup.
 * Grows when an owner uses /allow <userId> without a restart.
 */
let runtimeAllowedUsers = new Set<number>();

/**
 * Runtime owner set — seeded from vault (TELEGRAM_OWNER_IDS) at startup.
 */
let runtimeOwnerUsers = new Set<number>();

/**
 * Runtime admin set — seeded from approved admin requests at startup.
 * Grows when an owner grants admin via the inline button.
 */
let runtimeAdminUsers = new Set<number>();

/** True when both vault owner IDs and allowedUserIds are empty (dev mode = all owners). */
let devMode = false;

/** Returns true if user is within their rate limit window. Owners are never rate-limited. */
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

// ─────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────

/** Returns 'owner' | 'admin' | 'user' | 'denied'. devMode = everyone is owner. */
function getRole(userId: number, _config: AppConfig): "owner" | "admin" | "user" | "denied" {
    if (devMode) return 'owner';
    if (runtimeOwnerUsers.has(userId)) return "owner";
    if (runtimeAdminUsers.has(userId)) return "admin";
    if (runtimeAllowedUsers.has(userId)) return "user";
    return 'denied';
}

// ─────────────────────────────────────────────
// Channel export
// ─────────────────────────────────────────────

export default {
    name: "telegram",
    start,
} satisfies Channel;

// ─────────────────────────────────────────────
// Poll loop
// ─────────────────────────────────────────────

async function start(config: AppConfig): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");

    // Seed runtime auth state from vault + config
    const vaultOwnerIds = getVaultOwnerIds();
    devMode = vaultOwnerIds.length === 0 && config.telegram.allowedUserIds.length === 0;
    runtimeAllowedUsers = new Set(config.telegram.allowedUserIds);
    runtimeOwnerUsers = new Set(vaultOwnerIds);
    // Seed admins from persisted approved requests
    const savedRequests = loadRequests();
    runtimeAdminUsers = new Set(
        savedRequests.filter((r) => r.status === "approved" && r.role === "admin").map((r) => r.userId)
    );

    // Always notify owners on startup — reason varies based on how the agent was launched.
    // Also check for restart-context.json to auto-continue a task after self-restart.
    const restartContextFile = resolve(process.cwd(), ".agents", "restart-context.json");
    let restartContext: { reason?: string; continueTask?: string | null; restartedAt?: string } | null = null;

    if (existsSync(restartContextFile)) {
        try {
            restartContext = JSON.parse(readFileSync(restartContextFile, "utf-8"));
            // Delete immediately so it doesn't re-trigger on the next restart
            unlinkSync(restartContextFile);
            logger.info(`Restart context loaded: ${JSON.stringify(restartContext)}`);
        } catch {
            logger.warn("Failed to read restart-context.json — ignoring");
        }
    }

    if (vaultOwnerIds.length > 0) {
        const restartReason = restartContext?.reason ?? process.env.FORKSCOUT_RESTART_REASON;
        const continueTask = restartContext?.continueTask;
        const msg = restartReason
            ? `✅ <b>Agent restarted.</b>\n<i>Reason: ${restartReason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>${continueTask ? `\n<i>Auto-continuing: ${continueTask.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>` : ""}\n\nAgent is live. All systems normal.`
            : `🟢 <b>Agent is live.</b> All systems normal.`;
        logger.info(`Startup — notifying ${vaultOwnerIds.length} owner(s)`);
        for (const chatId of vaultOwnerIds) {
            await sendMessage(token, chatId, msg, "HTML").catch(() => { });
        }

        // Auto-continue: if the restart context specified a task, run it as a self-session
        // on the first owner's chat so the agent picks up where it left off.
        if (continueTask && vaultOwnerIds.length > 0) {
            const ownerChatId = vaultOwnerIds[0];
            logger.info(`Auto-continuing task after restart: "${continueTask}" (chat ${ownerChatId})`);

            // Small delay to let polling start first
            setTimeout(async () => {
                try {
                    const selfMessage = `[SELF-RESUME] I just restarted. Reason: ${restartContext?.reason ?? "unknown"}.\n\nTask to continue: ${continueTask}\n\nProceed now.`;

                    const result = await runAgent(getConfig(), {
                        userMessage: selfMessage,
                        role: "self",
                        meta: { channel: "telegram", chatId: ownerChatId },
                    });

                    if (result.text) {
                        const html = mdToHtml(result.text);
                        const chunks = splitMarkdown(html, 4000);
                        for (const chunk of chunks) {
                            await sendMessage(token, ownerChatId, chunk, "HTML", true).catch(() => { });
                        }
                    }
                    logger.info(`Auto-continue task completed (${result.steps} steps)`);
                } catch (err) {
                    logger.error(`Auto-continue task failed: ${err}`);
                    await sendMessage(token, ownerChatId, `⚠️ Auto-continue task failed: ${err}`, "HTML").catch(() => { });
                }
            }, 3000);
        }
    }

    logger.info("Starting long-poll...");

    // Register bot commands in Telegram's "/" autocomplete menu.
    // Scoped to owners only — after testing, move to default scope to open up for all users.
    const ownerCommands = [
        { command: "start", description: "Start the bot" },
        { command: "secret", description: "Manage encrypted secrets. Usage: store <alias> <value> | list | delete <alias> | env <VAR_NAME> [alias] | sync (imports all .env vars into vault)" },
        { command: "restart", description: "Safely restart the agent" },
        { command: "whoami", description: "Show your user ID and role" },
        { command: "allow", description: "Approve a pending access request" },
        { command: "deny", description: "Deny an access request" },
        { command: "pending", description: "List pending access requests" },
        { command: "requests", description: "Show all access requests" },
    ];
    for (const ownerId of vaultOwnerIds) {
        await setMyCommands(token, ownerCommands, { type: "chat", chat_id: ownerId });
    }
    logger.info("Bot commands registered in Telegram menu (owner-scoped).");

    let offset = 0;

    while (true) {
        try {
            const updates = await getUpdates(token, offset, config.telegram.pollingTimeout);

            for (const update of updates) {
                offset = update.update_id + 1;

                // Inline button presses
                if (update.callback_query) {
                    await handleCallbackQuery(config, token, update.callback_query).catch((err) =>
                        logger.error("Callback error:", err)
                    );
                    continue;
                }

                // Emoji reactions on messages
                if ((update as any).message_reaction) {
                    const reaction = (update as any).message_reaction;
                    const chatId = reaction.chat?.id;
                    const userId = reaction.user?.id ?? reaction.actor_chat?.id;
                    const newReactions: any[] = reaction.new_reaction ?? [];
                    if (chatId && newReactions.length > 0) {
                        const emoji = newReactions
                            .filter((r: any) => r.type === "emoji")
                            .map((r: any) => r.emoji)
                            .join("");
                        if (emoji) {
                            logger.info(`reaction from ${userId}: ${emoji} on msg ${reaction.message_id}`);
                            await setMessageReaction(token, chatId, reaction.message_id, emoji).catch(() => { });
                        }
                    }
                    continue;
                }

                // Regular messages
                const msg = update.message as Message | undefined;
                if (!hasContent(msg)) continue;

                const chatId = msg.chat.id;
                const userId = msg.from?.id ?? chatId;
                const username = msg.from?.username ?? null;
                const firstName = msg.from?.first_name ?? null;
                const text = msg.text ?? "";

                // /start — always allowed, before auth
                if (text === "/start") {
                    await sendMessage(token, chatId, `👋 Hi! I'm ${config.agent.name}. How can I help you?`);
                    continue;
                }

                // Auth check
                const role = getRole(userId, config);
                if (role === "denied") {
                    await handleDeniedUser(config, token, chatId, userId, username, firstName);
                    continue;
                }

                // Owner commands
                if (text.startsWith("/") && role === "owner") {
                    await handleOwnerCommand(token, chatId, userId, text).catch(async (err) => {
                        logger.error("Owner command error:", err);
                        await sendMessage(token, chatId, `⚠️ Command error: <code>${String(err?.message ?? err).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`, "HTML").catch(() => { });
                    });
                    continue;
                }

                // /secret — intercept BEFORE LLM, available to all authorized users
                // Usage: /secret store <alias> <value>
                //        /secret list
                //        /secret delete <alias>
                if (text.startsWith("/secret")) {
                    // Delete the user's message immediately — value should not stay in chat
                    await deleteMessage(token, chatId, msg.message_id).catch(() => { });
                    await handleSecretCommand(token, chatId, text).catch(async (err) => {
                        logger.error("Secret command error:", err);
                        await sendMessage(token, chatId, "⚠️ Secret command failed. Check usage: <code>/secret store &lt;alias&gt; &lt;value&gt;</code>", "HTML").catch(() => { });
                    });
                    continue;
                }

                // Silently ignore unknown commands for non-owners
                if (text.startsWith("/")) continue;

                // Input length cap
                const maxLen = config.telegram.maxInputLength;
                if (maxLen > 0 && text.length > maxLen) {
                    await sendMessage(token, chatId, `⚠️ Message too long (max ${maxLen} characters).`);
                    continue;
                }

                // Rate limiting (owners and admins bypass)
                if (role !== "owner" && role !== "admin" && !checkRateLimit(userId, config.telegram.rateLimitPerMinute)) {
                    logger.warn(`Rate limit exceeded for userId ${userId}`);
                    await sendMessage(token, chatId, "⏳ Too many messages. Please wait a moment.");
                    continue;
                }

                logger.info(`[${role}] ${userId}/${chatId}: ${text.slice(0, 80)}`);

                // Abort any in-flight task for this chat — new message takes priority
                const prevController = chatAbortControllers.get(chatId);
                if (prevController) {
                    logger.info(`[abort] Aborting previous task for chatId=${chatId}`);
                    prevController.abort();
                }

                // Create a new AbortController for this message
                const controller = new AbortController();
                chatAbortControllers.set(chatId, controller);

                // Queue per chat — serialises concurrent messages, never races
                const prev = chatQueues.get(chatId) ?? Promise.resolve();
                const next = prev.then(() => {
                    // If already aborted before we even start, skip
                    if (controller.signal.aborted) {
                        logger.info(`[abort] Skipping already-aborted task for chatId=${chatId}`);
                        return;
                    }
                    return handleMessage(config, token, chatId, msg, role as "owner" | "admin" | "user", controller.signal).catch(async (err) => {
                        // AbortError is expected when we cancel — not a real error
                        if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("aborted"))) {
                            logger.info(`[abort] Task aborted for chatId=${chatId}`);
                            return;
                        }
                        logger.error("Handler error:", err);
                        // Send clean user-facing message for LLM errors
                        const userMsg = (err instanceof LLMError)
                            ? `⚠️ ${err.classified.userMessage}`
                            : "⚠️ Something went wrong processing your message. Please try again.";
                        await sendMessage(token, chatId, userMsg).catch(() => { });
                    }).finally(() => {
                        // Clean up the controller if it's still ours
                        if (chatAbortControllers.get(chatId) === controller) {
                            chatAbortControllers.delete(chatId);
                        }
                    });
                });
                chatQueues.set(chatId, next);
            }
        } catch (err) {
            // TimeoutError from AbortSignal is expected during long-poll — not a real error
            if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
                continue;
            }
            logger.error("Poll error:", err);
            await sleep(3000);
        }
    }
}

// ─────────────────────────────────────────────
// Message handlers
// ─────────────────────────────────────────────

/** Main message handler — compiles history, calls agent, saves response, sends reply. */
async function handleMessage(
    config: AppConfig,
    token: string,
    chatId: number,
    rawMsg: Message,
    role: "owner" | "admin" | "user" = "user",
    abortSignal?: AbortSignal
): Promise<void> {
    const sessionKey = `telegram-${chatId}`;

    // ── 1. Migrate old split files if needed (one-time) ──────────────────────
    migrateSplitFiles(chatId);

    // ── 2. Save current user message to unified history ──────────────────────
    const compiledMsg = compileTelegramMessage(rawMsg);
    appendHistory(sessionKey, [compiledMsg]);

    // Acknowledge receipt — react 👀 on user's message so they know it's being processed
    await setMessageReaction(token, chatId, rawMsg.message_id, "👀").catch(() => { });

    // ── 3. Load & prepare full history via shared pipeline ───────────────────
    const allHistory = prepareHistory(
        loadHistory(sessionKey),
        { tokenBudget: config.telegram.historyTokenBudget }
    );

    // The current user message is the last in allHistory — pass it as userMessage,
    // everything before it as chatHistory.
    const rawContent = typeof compiledMsg.content === "string"
        ? compiledMsg.content
        : JSON.stringify(compiledMsg.content);
    const roleTag = role === "owner" ? "OWNER" : role === "admin" ? "ADMIN" : "USER";
    const currentContent = `[${roleTag}] ${rawContent}`;
    const chatHistory = allHistory.slice(0, -1);

    // ── 5. Stream agent response live into a single Telegram message ─────────
    //
    // One "response message" is created on the first token and edited in-place
    // as tokens arrive — this becomes the final reply, never deleted.
    //
    // Tool calls get a separate short-lived "tool bubble" that is deleted once
    // the tool step finishes and the agent resumes generating text.
    //
    // Reasoning (thinking) is shown as an italic suffix on the response message
    // while it lasts; it disappears when real text tokens follow.

    // ── Animated thinking placeholder ─────────────────────────────────────
    // Sent immediately so user sees feedback before the first LLM token.
    // Deleted the moment the first real token arrives.
    const DOTS = [".", "..", "..."];
    let dotIdx = 0;
    let thinkingMsgId: number | null = await sendMessage(token, chatId, "⚡ Thinking.").catch(() => null);
    let thinkingActive = true;
    // Fire the native Telegram "is typing..." indicator immediately
    sendTyping(token, chatId).catch(() => { });
    const thinkingLoop = (async () => {
        let typingCounter = 0;
        while (thinkingActive) {
            await sleep(500);
            if (!thinkingActive) break;
            dotIdx = (dotIdx + 1) % DOTS.length;
            if (thinkingMsgId) {
                await editMessage(token, chatId, thinkingMsgId, `⚡ Thinking${DOTS[dotIdx]}`).catch(() => { });
            }
            // Re-send typing action every ~4s (Telegram expires it after 5s)
            typingCounter++;
            if (typingCounter % 8 === 0) {
                sendTyping(token, chatId).catch(() => { });
            }
        }
    })();

    /** The live response message — created on first token, kept as final reply. */
    let responseMsgId: number | null = null;
    /** Accumulated plain text from all text tokens so far. */
    let responseText = "";
    /** Italic thinking suffix appended to responseText while reasoning is active. */
    let thinkingSuffix = "";
    /** Temporary tool bubble sent when a tool call fires — deleted after step. */
    let toolBubbleId: number | null = null;
    /** Flush timer for edit-rate limiting (max ~1 edit/sec per Telegram TOS). */
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    /** True once the first text token arrives — turns off typing loop. */
    let firstToken = true;

    const reasoningTagCfg = config.llm.reasoningTag?.trim();
    const thinkStripRe = reasoningTagCfg
        ? new RegExp(`<${reasoningTagCfg}>[\\s\\S]*?<\\/${reasoningTagCfg}>\\n?`, "gi")
        : null;

    const flushToTelegram = async (): Promise<void> => {
        // Strip any leaked <think> blocks before displaying
        const cleanText = thinkStripRe ? responseText.replace(thinkStripRe, "").trim() : responseText;
        if (!cleanText && !thinkingSuffix) return;

        let display: string;
        let parseMode: "HTML" | undefined;

        if (thinkingSuffix) {
            // Escape plain response text for HTML, append italic thinking suffix
            const escapedText = cleanText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            display = escapedText + thinkingSuffix;
            parseMode = "HTML";
        } else {
            display = cleanText;
            parseMode = undefined;
        }

        // Cap at 3900 chars during streaming (Telegram limit 4096)
        const safe = display.length > 3900 ? display.slice(0, 3897) + "…" : display;
        if (responseMsgId) {
            await editMessage(token, chatId, responseMsgId, safe, parseMode).catch(() => { });
        } else {
            responseMsgId = await sendMessage(token, chatId, safe, parseMode).catch(() => null);
        }
    };

    const scheduleFlush = (): void => {
        if (flushTimer) return; // already scheduled
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushToTelegram().catch(() => { });
        }, 800);
    };

    const onToolCall = async (toolName: string, input: unknown): Promise<void> => {
        const label = TOOL_LABELS[toolName] ?? toolName.replace(/_/g, " ");
        const preview = toolInputPreview(input);
        const text = preview
            ? `⚙️ <b>${label}</b>\n<code>${preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`
            : `⚙️ <b>${label}</b>`;
        toolBubbleId = await sendMessage(token, chatId, text, "HTML").catch(() => null);
    };

    const onStepFinish = async (hadToolCalls: boolean): Promise<void> => {
        if (hadToolCalls && toolBubbleId) {
            await deleteMessage(token, chatId, toolBubbleId).catch(() => { });
            toolBubbleId = null;
        }
    };

    const onThinking = async (text: string): Promise<void> => {
        const escaped = text.slice(0, 200).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        thinkingSuffix = `\n\n<i>\ud83d\udcad ${escaped}</i>`;
        scheduleFlush();
    };

    let streamResult: Awaited<ReturnType<typeof streamAgent>>;
    try {
        streamResult = await streamAgent(config, {
            userMessage: currentContent,
            chatHistory,
            role,
            meta: { channel: "telegram", chatId },
            abortSignal,
            onToolCall,
            onStepFinish,
            onThinking,
        });

        // Consume the token stream — each chunk updates the response message
        for await (const token_text of streamResult.textStream) {
            // First token: stop thinking animation and delete placeholder
            if (firstToken) {
                firstToken = false;
                thinkingActive = false;
                if (thinkingMsgId) {
                    const _id = thinkingMsgId;
                    thinkingMsgId = null; // null first — prevents loop from editing a deleted message
                    await deleteMessage(token, chatId, _id).catch(() => { });
                }
                thinkingSuffix = "";
            }
            responseText += token_text;
            scheduleFlush();
        }

        // Final flush — ensure last tokens are sent
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await flushToTelegram();

    } finally {
        thinkingActive = false;
        if (thinkingMsgId) {
            const _id = thinkingMsgId;
            thinkingMsgId = null; // null first — prevents loop from editing a deleted message
            await deleteMessage(token, chatId, _id).catch(() => { });
        }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        await thinkingLoop;
    }

    // ── Abort check — if we were cancelled, clean up partial UI and bail out ──
    if (abortSignal?.aborted) {
        logger.info(`[abort] Cleaning up aborted task for chatId=${chatId}`);
        // Delete any partial response message and tool bubble
        if (responseMsgId) await deleteMessage(token, chatId, responseMsgId).catch(() => { });
        if (toolBubbleId) await deleteMessage(token, chatId, toolBubbleId).catch(() => { });
        return;
    }

    const result = await streamResult!.finalize();

    // Clean up any leftover tool bubble (edge case: agent ended mid-tool)
    if (toolBubbleId) await deleteMessage(token, chatId, toolBubbleId).catch(() => { });

    // ── 6. Save response messages to unified history ─────────────────────────
    appendHistory(sessionKey, result.responseMessages);

    // ── 6b. Embed new turns for semantic search (fire-and-forget) ────────────
    embedNewTurns(sessionKey, loadHistory(sessionKey));

    // ── 7. Finalise reply ────────────────────────────────────────────────────
    // The response message already exists with streamed plain text.
    // Now upgrade it to final formatted HTML. If the final text is longer than
    // what was streamed (truncated), send proper split chunks and delete the draft.
    const replyText = result.text?.trim();
    if (!replyText) {
        logger.warn(`[agent] empty reply for chatId=${chatId} message_id=${rawMsg.message_id}`);
        if (responseMsgId) await deleteMessage(token, chatId, responseMsgId).catch(() => { });
        await sendMessage(token, chatId, "⚠️ No response from agent.");
        await setMessageReaction(token, chatId, rawMsg.message_id, "✅").catch(() => { });
        return;
    }

    // Split raw markdown first (protecting fenced code blocks), then convert each
    // chunk to HTML independently. This ensures tags are always balanced — the old
    // splitMessage(html) pattern could bisect <pre><code> blocks containing \n\n.
    const chunks = splitMarkdown(replyText).map(mdToHtml);

    if (chunks.length === 1) {
        // Single chunk — upgrade the existing message in-place
        if (responseMsgId) {
            await editMessage(token, chatId, responseMsgId, chunks[0], "HTML")
                .catch(() => editMessage(token, chatId, responseMsgId!, stripHtml(chunks[0])));
        } else {
            await sendMessage(token, chatId, chunks[0], "HTML")
                .catch(() => sendMessage(token, chatId, stripHtml(chunks[0])));
        }
    } else {
        // Multiple chunks — edit first chunk in-place (no flicker), send rest fresh
        const [first, ...rest] = chunks;
        if (responseMsgId) {
            await editMessage(token, chatId, responseMsgId, first, "HTML")
                .catch(() => editMessage(token, chatId, responseMsgId!, stripHtml(first)));
        } else {
            await sendMessage(token, chatId, first, "HTML")
                .catch(() => sendMessage(token, chatId, stripHtml(first)));
        }
        for (const chunk of rest) {
            await sendMessage(token, chatId, chunk, "HTML")
                .catch(() => sendMessage(token, chatId, stripHtml(chunk)));
        }
    }

    // Mark done — upgrade 👀 to ✅ on user's message
    await setMessageReaction(token, chatId, rawMsg.message_id, "✅").catch(() => { });
}

/** Handles inline keyboard button presses (callback_query updates). */
async function handleCallbackQuery(
    config: AppConfig,
    token: string,
    cb: NonNullable<Update["callback_query"]>
): Promise<void> {
    const cbUserId = cb.from.id;
    const cbChatId = cb.message?.chat.id ?? cbUserId;
    const cbMessageId = cb.message?.message_id;
    const cbRole = getRole(cbUserId, config);

    if (cbRole !== "owner") {
        await answerCallbackQuery(token, cb.id, "⛔ Owners only.");
        return;
    }

    const [action, rawId] = cb.data!.split(":");
    const targetId = parseInt(rawId, 10);

    if (isNaN(targetId)) {
        await answerCallbackQuery(token, cb.id, "⚠️ Invalid user ID.");
        return;
    }

    try {
        if (action === "allow_user" || action === "allow_admin") {
            const role: ApprovedRole = action === "allow_admin" ? "admin" : "user";
            const requests = loadRequests();
            const req = requests.find((r) => r.userId === targetId);

            if (role === "admin") {
                runtimeAdminUsers.add(targetId);
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
            if (cbMessageId) await editMessageReplyMarkup(token, cbChatId, cbMessageId, null);

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
            if (cbMessageId) await editMessageReplyMarkup(token, cbChatId, cbMessageId, null);

        } else {
            await answerCallbackQuery(token, cb.id, "Unknown action.");
        }
    } catch (err: any) {
        logger.error("Callback action error:", err);
        await answerCallbackQuery(token, cb.id, "⚠️ Error processing action.");
    }
}

/** Handles denied users — sends access request to owners on first contact. */
async function handleDeniedUser(
    config: AppConfig,
    token: string,
    chatId: number,
    userId: number,
    username: string | null,
    firstName: string | null
): Promise<void> {
    logger.warn(`Unauthorized userId ${userId} (chatId ${chatId}) username=${username ?? "none"} — rejected`);

    const requests = loadRequests();
    const existing = requests.find((r) => r.userId === userId);

    if (!existing) {
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

        const buttons = [[
            { text: "✅ Allow (user)", callback_data: `allow_user:${userId}` },
            { text: "👑 Allow (admin)", callback_data: `allow_admin:${userId}` },
            { text: "❌ Deny", callback_data: `deny:${userId}` },
        ]];

        for (const ownerId of getVaultOwnerIds()) {
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
}

// ─────────────────────────────────────────────
// Owner commands & restart
// ─────────────────────────────────────────────

/** Handles /secret commands — runs at channel level, NEVER reaches the LLM.
 *  Usage:
 *    /secret store <alias> <value>   — store a secret under an alias
 *    /secret list                    — list stored alias names (no values)
 *    /secret delete <alias>          — remove an alias
 */
async function handleSecretCommand(token: string, chatId: number, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    // parts[0] = "/secret", parts[1] = subcommand, parts[2] = alias, parts[3..] = value
    const sub = parts[1]?.toLowerCase();

    if (!sub || sub === "help") {
        await sendMessage(token, chatId,
            `🔐 <b>Secret Vault</b>\n\n` +
            `<code>/secret store &lt;alias&gt; &lt;value&gt;</code>\n` +
            `  Save a secret. Use <code>{{secret:alias}}</code> in any message.\n\n` +
            `<code>/secret env &lt;ENV_VAR&gt; [alias]</code>\n` +
            `  Import a server-side env var — value never travels through Telegram.\n\n` +
            `<code>/secret sync</code>\n` +
            `  Import ALL env vars from .env file into the vault at once.\n\n` +
            `<code>/secret list</code>\n` +
            `  Show stored alias names (values never shown).\n\n` +
            `<code>/secret delete &lt;alias&gt;</code>\n` +
            `  Remove an alias from the vault.\n\n` +
            `⚠️ Your /secret messages are deleted immediately — values never stay in chat.`,
            "HTML"
        );
        return;
    }

    if (sub === "store") {
        const alias = parts[2];
        // Value = everything after alias (supports values with spaces)
        const value = parts.slice(3).join(" ");
        if (!alias || !value) {
            await sendMessage(token, chatId,
                `⚠️ Usage: <code>/secret store &lt;alias&gt; &lt;value&gt;</code>\n` +
                `Example: <code>/secret store db_pass mypassword123</code>`,
                "HTML"
            );
            return;
        }
        const cleanAlias = alias.trim().toLowerCase().replace(/\s+/g, "_");
        setSecret(cleanAlias, value);
        logger.info(`[vault] secret stored: ${cleanAlias} (value redacted)`);
        await sendMessage(token, chatId,
            `✅ <b>Secret stored.</b>\n\n` +
            `Alias: <code>${cleanAlias}</code>\n` +
            `Use as: <code>{{secret:${cleanAlias}}}</code>\n\n` +
            `<i>The actual value was never sent to the AI.</i>`,
            "HTML"
        );
        return;
    }

    if (sub === "list") {
        const aliases = listAliases();
        if (aliases.length === 0) {
            await sendMessage(token, chatId, "🔐 Vault is empty.");
            return;
        }
        const lines = aliases.map(a => `• <code>{{secret:${a}}}</code>`).join("\n");
        await sendMessage(token, chatId,
            `🔐 <b>Stored secrets (${aliases.length})</b>\n\n${lines}\n\n<i>Values are never shown — only alias names.</i>`,
            "HTML"
        );
        return;
    }

    if (sub === "delete") {
        const alias = parts[2];
        if (!alias) {
            await sendMessage(token, chatId, "⚠️ Usage: <code>/secret delete &lt;alias&gt;</code>", "HTML");
            return;
        }
        const deleted = deleteSecret(alias.trim());
        await sendMessage(token, chatId,
            deleted ? `🗑️ Secret <code>${alias}</code> deleted.` : `⚠️ Alias <code>${alias}</code> not found.`,
            "HTML"
        );
        return;
    }

    // /secret env <ENV_VAR_NAME> [alias]
    // Reads the value from process.env server-side — value never travels through Telegram.
    if (sub === "env") {
        const envVar = parts[2];
        if (!envVar) {
            await sendMessage(token, chatId,
                `⚠️ Usage: <code>/secret env &lt;ENV_VAR_NAME&gt; [alias]</code>\n` +
                `Example: <code>/secret env OPENROUTER_API_KEY openrouter</code>\n` +
                `If alias is omitted, uses lowercase of the var name.`,
                "HTML"
            );
            return;
        }
        const value = process.env[envVar];
        if (!value) {
            await sendMessage(token, chatId,
                `⚠️ Env var <code>${envVar}</code> is not set or empty on this server.`,
                "HTML"
            );
            return;
        }
        const alias = (parts[3] ?? envVar).trim().toLowerCase().replace(/[^a-z0-9_\-]/g, "_");
        setSecret(alias, value);
        logger.info(`[vault] env var imported: ${envVar} → ${alias} (value redacted)`);
        await sendMessage(token, chatId,
            `✅ <b>Env var imported.</b>\n\n` +
            `<code>${envVar}</code> → alias <code>${alias}</code>\n` +
            `Use as: <code>{{secret:${alias}}}</code>\n\n` +
            `<i>Value was read server-side — never sent through Telegram.</i>`,
            "HTML"
        );
        return;
    }

    // /secret sync — import ALL env vars from .env file into the vault
    if (sub === "sync") {
        const { existsSync, readFileSync: rfs } = await import("node:fs");
        const { resolve: res } = await import("node:path");
        const envFile = res(process.cwd(), ".env");
        if (!existsSync(envFile)) {
            await sendMessage(token, chatId, "⚠️ No .env file found in project root.", "HTML");
            return;
        }
        const lines = rfs(envFile, "utf-8").split("\n");
        const stored: string[] = [];
        const skipped: string[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Strip surrounding quotes if present
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (!key || !val) { skipped.push(key || "(empty)"); continue; }
            const alias = key.toLowerCase().replace(/[^a-z0-9_\-]/g, "_");
            setSecret(alias, val);
            stored.push(`<code>${key}</code> → <code>{{secret:${alias}}}</code>`);
        }
        logger.info(`[vault] sync: stored ${stored.length} vars, skipped ${skipped.length}`);
        const msg = stored.length === 0
            ? "⚠️ No valid entries found in .env file."
            : `✅ <b>Synced ${stored.length} env var(s) to vault.</b>\n\n${stored.join("\n")}` +
            (skipped.length > 0 ? `\n\n<i>Skipped ${skipped.length} empty/invalid entries.</i>` : "") +
            `\n\n<i>Values were read server-side — never sent through Telegram.</i>`;
        await sendMessage(token, chatId, msg, "HTML");
        return;
    }

    await sendMessage(token, chatId,
        `⚠️ Unknown subcommand. Use <code>/secret help</code> for usage.`,
        "HTML"
    );
}

/** Handles privileged slash commands for owners: /restart, /whoami, /allow, /deny, /pending, /requests. */
async function handleOwnerCommand(token: string, chatId: number, ownerUserId: number, text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0];
    const arg = parts[1] ?? "";

    if (cmd === "/restart") {
        await handleRestart(token, chatId);
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

    // /backfill — re-index chat history embeddings for semantic search
    if (cmd === "/backfill") {
        const { backfillEmbeddings } = await import("@/channels/history-embeddings.ts");
        const { loadHistory: loadH } = await import("@/channels/chat-store.ts");
        const sessionKey = `telegram-${chatId}`;
        const history = loadH(sessionKey);
        if (history.length === 0) {
            await sendMessage(token, chatId, "⚠️ No history to embed.");
            return;
        }
        await sendMessage(token, chatId, `🔄 Backfilling embeddings for ${history.length} messages...`);
        try {
            const result = await backfillEmbeddings(sessionKey, history);
            await sendMessage(
                token, chatId,
                `✅ <b>Backfill complete.</b>\n• Turns embedded: <code>${result.chunksEmbedded}</code>\n• Tokens used: <code>${result.totalTokens}</code>`,
                "HTML"
            );
        } catch (err: any) {
            await sendMessage(token, chatId, `❌ Backfill failed: <code>${String(err?.message ?? err).slice(0, 300)}</code>`, "HTML");
        }
        return;
    }

    // Unknown owner command — silently ignore (don't route to agent)
}

/** Blue-green restart: typecheck → spawn → verify alive → hand off. */
async function handleRestart(token: string, chatId: number): Promise<void> {
    await sendMessage(token, chatId, "🔄 Checking code before restart...");

    const tsc = Bun.spawnSync(["bun", "run", "typecheck"], { cwd: process.cwd() });
    if (tsc.exitCode !== 0) {
        const output = (new TextDecoder().decode(tsc.stdout) + new TextDecoder().decode(tsc.stderr)).trim().slice(0, 1500);
        await sendMessage(token, chatId, `❌ <b>Restart aborted — typecheck failed.</b>\n<pre>${output}</pre>`, "HTML");
        return;
    }

    await sendMessage(token, chatId, "✅ Typecheck passed. Spawning new instance...");

    const child = Bun.spawn(["bun", "run", "src/index.ts"], {
        cwd: process.cwd(),
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
    });

    await sleep(6000);

    if (child.exitCode !== null) {
        await sendMessage(
            token, chatId,
            `❌ <b>Restart aborted — new instance crashed at startup</b> (exit ${child.exitCode}).\nThe current bot is still running.\n\n🔍 Asking the agent to self-diagnose...`,
            "HTML"
        );

        const diagTask =
            `SYSTEM: Self-restart just failed. The new instance crashed at startup with exit code ${child.exitCode}.\n` +
            `The current process is still running.\n\n` +
            `Your job:\n` +
            `1. Check recent logs: tail -50 .agents/activity.log\n` +
            `2. Check for startup errors: bun run src/index.ts 2>&1 | head -40 (kill after 5s)\n` +
            `3. Identify the root cause (broken code, missing env var, bad config, MCP failure, etc.)\n` +
            `4. Fix it\n` +
            `5. Run bun run typecheck to verify\n` +
            `6. Send /restart to try again\n\n` +
            `Do not wait for instructions. Start diagnosing now.`;

        runAgent(getConfig(), { userMessage: diagTask, meta: { channel: "telegram", chatId } })
            .then(async (result) => {
                if (!result.text) return;
                for (const chunk of splitMarkdown(result.text).map(mdToHtml)) {
                    await sendMessage(token, chatId, chunk, "HTML").catch(() => sendMessage(token, chatId, stripHtml(chunk)));
                }
            })
            .catch((err) => logger.error("Self-diagnosis agent error:", err));

        return;
    }

    await sendMessage(token, chatId, "✅ New instance is healthy. Handing off now.");
    process.exit(0);
}

// ─────────────────────────────────────────────
// Telegram API utils
// ─────────────────────────────────────────────

async function getUpdates(token: string, offset: number, timeout: number): Promise<Update[]> {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}&allowed_updates=["message","callback_query","message_reaction"]`;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 10) * 1000) });
        const data = await res.json() as { ok: boolean; result: Update[] };
        if (!data.ok) return [];
        return data.result;
    } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return [];
        throw err;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────
// Migration helpers
// ─────────────────────────────────────────────

/**
 * One-time migration: split-by-role files (user.json, assistant.json, tool.json)
 * → unified history.json. Handles raw Telegram Message objects in user.json.
 */
function migrateSplitFiles(chatId: number): void {
    const sessionKey = `telegram-${chatId}`;
    const dir = resolve(CHATS_DIR, `telegram-${chatId}`);
    const userFile = resolve(dir, "user.json");

    // Only migrate if old user.json exists and history.json doesn't
    if (!existsSync(userFile)) return;
    if (existsSync(resolve(dir, "history.json"))) {
        // history.json already exists — just clean up leftover split files
        for (const name of ["user.json", "assistant.json", "tool.json", "system.json"]) {
            try { const p = resolve(dir, name); if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
        }
        return;
    }

    logger.info(`Migrating split chat files → history.json for chat ${chatId}`);

    type SeqEntry = { seq: number } & Record<string, any>;
    const all: SeqEntry[] = [];

    // user.json: raw Telegram Message objects — compile to ModelMessage
    try {
        const rawUsers = JSON.parse(readFileSync(userFile, "utf-8"));
        if (Array.isArray(rawUsers)) {
            for (const m of rawUsers) {
                if (m && typeof m === "object" && typeof m.date === "number") {
                    all.push({ seq: m.date, ...compileTelegramMessage(m) });
                }
            }
        }
    } catch { /* skip corrupted */ }

    // assistant.json + tool.json: already have seq + role/content
    for (const role of ["assistant", "tool", "system"]) {
        const path = resolve(dir, `${role}.json`);
        if (!existsSync(path)) continue;
        try {
            const parsed = JSON.parse(readFileSync(path, "utf-8"));
            if (Array.isArray(parsed)) {
                for (const entry of parsed) {
                    if (entry && typeof entry === "object" && typeof entry.seq === "number") {
                        all.push(entry);
                    }
                }
            }
        } catch { /* skip corrupted */ }
    }

    if (all.length > 0) {
        all.sort((a, b) => a.seq - b.seq);
        const messages: ModelMessage[] = all.map(({ seq: _, ...msg }) => msg as ModelMessage);
        saveHistory(sessionKey, messages);
        logger.info(`Migrated ${messages.length} messages for chat ${chatId}`);
    }

    // Clean up old split files
    for (const name of ["user.json", "assistant.json", "tool.json", "system.json"]) {
        try { const p = resolve(dir, name); if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
    }
}

// ─────────────────────────────────────────────
// Guards
// ─────────────────────────────────────────────

/** Returns true if the message carries any content worth processing. */
function hasContent(msg: Message | undefined): msg is Message {
    if (!msg) return false;
    // Since we pass the full raw JSON to the LLM, any message with
    // at least one field beyond the base metadata is valid content.
    // The base metadata fields (always present) are: message_id, date, chat.
    const { message_id, date, chat, ...rest } = msg as any;
    return Object.keys(rest).length > 0;
}
