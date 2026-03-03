// src/channels/whatsapp/handle-message.ts — Per-chat message handling with queue + abort
//
// Incoming Baileys messages are validated, queued per-chat (serialised, never raced),
// then streamed through the agent. Each chat gets its own abort controller so
// a new message from the same chat cancels the previous in-flight task.

import type { AppConfig } from "@/config.ts";
import { getConfig } from "@/config.ts";
import { streamAgent } from "@/agent/index.ts";
import { prepareHistory } from "@/channels/prepare-history.ts";
import { loadHistory, appendHistory } from "@/channels/chat-store.ts";
import { log } from "@/logs/logger.ts";
import { makeWASocket } from "@whiskeysockets/baileys";
import { getRole } from "@/channels/whatsapp/auth.ts";
import { sleep, splitText } from "@/channels/whatsapp/utils.ts";
import { compileWhatsAppMessage } from "@/channels/whatsapp/compile-message.ts";
import { cacheMessage } from "@/channels/whatsapp/state.ts";

const logger = log("whatsapp");

type Sock = ReturnType<typeof makeWASocket>;

// ── Per-chat sequential queue + abort controller ─────────────────────────────
const chatQueues = new Map<string, Promise<void>>();
const chatAbortControllers = new Map<string, AbortController>();

// ── Rate limiting ────────────────────────────────────────────────────────────
const rateLimiter = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(jid: string, maxPerMinute: number): boolean {
    if (maxPerMinute <= 0) return true;
    const now = Date.now();
    const entry = rateLimiter.get(jid);
    if (!entry || now - entry.windowStart > 60_000) {
        rateLimiter.set(jid, { count: 1, windowStart: now });
        return true;
    }
    entry.count++;
    return entry.count <= maxPerMinute;
}

/** Extract text content from a Baileys message object. */
function extractText(message: any): string {
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.documentMessage?.caption) return message.documentMessage.caption ?? "";
    return "";
}

/** Check if a Baileys message contains media (image, video, audio, document, sticker). */
function hasMedia(message: any): boolean {
    return !!(message.imageMessage || message.videoMessage || message.audioMessage
        || message.documentMessage || message.stickerMessage);
}

/** Process a batch of incoming messages from a Baileys messages.upsert event. */
export function processIncomingMessages(sock: Sock, messages: any[]): void {
    const config = getConfig();
    const wa = config.channels.whatsapp;

    for (const msg of messages) {
        if (msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === "status@broadcast") continue;
        if (msg.message?.ephemeralMessage || msg.message?.pollCreationMessage) continue;
        if (!msg.message) continue;

        const text = extractText(msg.message);
        const media = hasMedia(msg.message);
        if (!text.trim() && !media) continue;

        const isGroup = remoteJid.endsWith("@g.us");
        const senderJid = isGroup ? (msg.key.participant ?? remoteJid) : remoteJid;
        const senderName = msg.pushName ?? senderJid.split("@")[0];

        const role = getRole(senderJid);
        if (role === "denied") { logger.warn(`Denied message from ${senderJid}`); continue; }

        const maxLen = wa?.maxInputLength ?? 2000;
        if (maxLen > 0 && text.length > maxLen) {
            sock.sendMessage(remoteJid, { text: `⚠️ Message too long (max ${maxLen} characters).` }).catch(() => { });
            continue;
        }

        if (role !== "owner" && !checkRateLimit(senderJid, wa?.rateLimitPerMinute ?? 15)) {
            logger.warn(`Rate limit for ${senderJid}`);
            sock.sendMessage(remoteJid, { text: "⏳ Too many messages. Please wait." }).catch(() => { });
            continue;
        }

        logger.info(`[${role}] ${senderName}: ${text.slice(0, 80)}`);
        if (msg.key.id) cacheMessage(msg.key.id, msg);
        enqueueMessage(config, sock, remoteJid, senderJid, senderName, msg, role, wa);
    }
}

/** Enqueue a validated message for sequential processing per chat. */
function enqueueMessage(
    config: AppConfig, sock: Sock, remoteJid: string, senderJid: string,
    senderName: string, rawMsg: any, role: "owner" | "user", wa: AppConfig["channels"]["whatsapp"],
): void {
    const isGroup = remoteJid.endsWith("@g.us");
    const chatKey = isGroup ? remoteJid : senderJid;
    const sessionKey = `whatsapp-${chatKey.replace("@s.whatsapp.net", "").replace("@g.us", "-g")}`;

    // Abort any in-flight task for this chat
    const prev = chatAbortControllers.get(chatKey);
    if (prev) { logger.info(`[abort] Aborting previous task for ${chatKey}`); prev.abort(); }

    const controller = new AbortController();
    chatAbortControllers.set(chatKey, controller);

    const prevPromise = chatQueues.get(chatKey) ?? Promise.resolve();
    const next = prevPromise.then(() => {
        if (controller.signal.aborted) return;
        return handleMessage(config, sock, remoteJid, senderName, rawMsg, role, sessionKey, wa, controller.signal)
            .catch(async (err) => {
                if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("aborted"))) {
                    logger.info(`[abort] Task aborted for ${chatKey}`);
                    return;
                }
                logger.error(`Handler error for ${chatKey}:`, err);
                await sock.sendMessage(remoteJid, { text: "⚠️ Something went wrong. Please try again." }).catch(() => { });
            })
            .finally(() => { if (chatAbortControllers.get(chatKey) === controller) chatAbortControllers.delete(chatKey); });
    });
    chatQueues.set(chatKey, next);
}

/** Stream the agent response and send it back to the WhatsApp user. */
async function handleMessage(
    config: AppConfig, sock: Sock, remoteJid: string, senderName: string,
    rawMsg: any, role: "owner" | "user", sessionKey: string,
    wa: AppConfig["channels"]["whatsapp"], abortSignal: AbortSignal,
): Promise<void> {
    const compiledMsg = compileWhatsAppMessage(rawMsg);
    appendHistory(sessionKey, [compiledMsg]);

    const allHistory = prepareHistory(
        loadHistory(sessionKey),
        { tokenBudget: wa?.historyTokenBudget ?? 12000 },
    );
    const chatHistory = allHistory.slice(0, -1);
    const roleTag = role === "owner" ? "OWNER" : "USER";
    const rawContent = typeof compiledMsg.content === "string"
        ? compiledMsg.content
        : JSON.stringify(compiledMsg.content);

    await sock.sendPresenceUpdate("composing", remoteJid).catch(() => { });
    let composingActive = true;
    const composingLoop = (async () => {
        while (composingActive) { await sleep(4000); if (!composingActive) break; await sock.sendPresenceUpdate("composing", remoteJid).catch(() => { }); }
    })();

    try {
        const stream = await streamAgent(config, {
            userMessage: `[${roleTag}] ${rawContent}`,
            chatHistory, role,
            meta: { channel: "whatsapp", chatId: remoteJid },
            abortSignal,
        });

        let responseText = "";
        for await (const token of stream.textStream) responseText += token;
        const result = await stream.finalize();

        composingActive = false; await composingLoop;
        await sock.sendPresenceUpdate("paused", remoteJid).catch(() => { });
        if (abortSignal.aborted) return;

        const replyText = result.text?.trim();
        if (!replyText) { await sock.sendMessage(remoteJid, { text: "⚠️ No response from agent." }).catch(() => { }); return; }

        if (replyText.length <= 4096) {
            await sock.sendMessage(remoteJid, { text: replyText }).catch(() => { });
        } else {
            for (const chunk of splitText(replyText, 4096)) {
                await sock.sendMessage(remoteJid, { text: chunk }).catch(() => { });
                await sleep(500);
            }
        }
        appendHistory(sessionKey, result.responseMessages);
    } catch (err) {
        composingActive = false; await composingLoop;
        await sock.sendPresenceUpdate("paused", remoteJid).catch(() => { });
        throw err;
    }
}
