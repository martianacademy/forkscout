// src/channels/whatsapp/index.ts — WhatsApp Baileys channel

import { getConfig, type AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { streamAgent } from "@/agent/index.ts";
import { prepareHistory } from "@/channels/prepare-history.ts";
import { loadHistory, appendHistory } from "@/channels/chat-store.ts";
import { log } from "@/logs/logger.ts";
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { ModelMessage } from "ai";

const logger = log("whatsapp");

export default {
    name: "whatsapp",
    start,
} satisfies Channel;

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

// ── Auth helpers ─────────────────────────────────────────────────────────────
let ownerJids: Set<string>;
let allowedJids: Set<string>;
let devMode: boolean;

function initAuth(config: AppConfig): void {
    const wa = config.whatsapp;
    const vaultOwnerJids = (process.env.WHATSAPP_OWNER_JIDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const cfgOwnerJids = wa?.ownerJids ?? [];
    ownerJids = new Set([...vaultOwnerJids, ...cfgOwnerJids]);
    allowedJids = new Set(wa?.allowedJids ?? []);
    devMode = ownerJids.size === 0 && allowedJids.size === 0;

    if (devMode) {
        logger.warn("No owner/allowed JIDs configured — DEV MODE (everyone is owner)");
    } else {
        logger.info(`Auth: ${ownerJids.size} owner(s), ${allowedJids.size} allowed user(s)`);
    }
}

function getRole(senderJid: string): "owner" | "user" | "denied" {
    if (devMode) return "owner";
    if (ownerJids.has(senderJid)) return "owner";
    if (allowedJids.has(senderJid)) return "user";
    // If no allowlist, everyone except owners is a user
    if (allowedJids.size === 0) return "user";
    return "denied";
}

// ── Main channel ─────────────────────────────────────────────────────────────
async function start(config: AppConfig): Promise<void> {
    const wa = config.whatsapp;
    const sessionDir = resolve(process.cwd(), wa?.sessionDir ?? ".agents/whatsapp-sessions");

    if (!existsSync(sessionDir)) {
        mkdirSync(sessionDir, { recursive: true });
    }

    initAuth(config);

    logger.info(`Starting WhatsApp channel (session: ${sessionDir})`);

    const connectSocket = async (): Promise<void> => {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ["ForkScout", "Chrome", "120.0.0"],
        });

        // Save credentials on update
        sock.ev.on("creds.update", saveCreds);

        // Handle connection lifecycle
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info("Scan QR code in terminal to connect WhatsApp");
            }

            if (connection === "close") {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                logger.warn(`Connection closed (reason: ${reason})`);

                if (reason === DisconnectReason.loggedOut) {
                    logger.error("Logged out — delete session dir and re-scan QR code");
                    return; // Don't reconnect — user logged out
                }

                // Reconnect after a short delay
                logger.info("Reconnecting in 3s...");
                await sleep(3000);
                connectSocket(); // Recursive reconnect
            } else if (connection === "open") {
                logger.info("Connected to WhatsApp!");
            }
        });

        // Handle incoming messages
        sock.ev.on("messages.upsert", async ({ messages, type }) => {
            if (type !== "notify") return;
            const config = getConfig(); // Re-read config for hot-reload

            for (const msg of messages) {
                if (msg.key.fromMe) continue;

                // Skip status broadcasts, ephemeral, polls
                const remoteJid = msg.key.remoteJid;
                if (!remoteJid || remoteJid === "status@broadcast") continue;
                if (msg.message?.ephemeralMessage) continue;
                if (msg.message?.pollCreationMessage) continue;

                // Extract text content
                const message = msg.message;
                if (!message) continue;

                let text = "";
                if (message.conversation) {
                    text = message.conversation;
                } else if (message.extendedTextMessage?.text) {
                    text = message.extendedTextMessage.text;
                } else if (message.imageMessage?.caption) {
                    text = message.imageMessage.caption;
                } else if (message.videoMessage?.caption) {
                    text = message.videoMessage.caption;
                } else if (message.documentMessage?.caption) {
                    text = message.documentMessage?.caption ?? "";
                }

                if (!text.trim()) continue;

                // Determine sender JID
                const isGroup = remoteJid.endsWith("@g.us");
                const senderJid = isGroup
                    ? (msg.key.participant ?? remoteJid)
                    : remoteJid;
                const senderName = msg.pushName ?? senderJid.split("@")[0];

                // Auth check
                const role = getRole(senderJid);
                if (role === "denied") {
                    logger.warn(`Denied message from ${senderJid}`);
                    continue;
                }

                // Input length cap
                const maxLen = wa?.maxInputLength ?? 2000;
                if (maxLen > 0 && text.length > maxLen) {
                    await sock.sendMessage(remoteJid, { text: `⚠️ Message too long (max ${maxLen} characters).` }).catch(() => { });
                    continue;
                }

                // Rate limiting (owners bypass)
                if (role !== "owner" && !checkRateLimit(senderJid, wa?.rateLimitPerMinute ?? 15)) {
                    logger.warn(`Rate limit for ${senderJid}`);
                    await sock.sendMessage(remoteJid, { text: "⏳ Too many messages. Please wait." }).catch(() => { });
                    continue;
                }

                logger.info(`[${role}] ${senderName}: ${text.slice(0, 80)}`);

                // Chat key — use sender for private, remoteJid for group
                const chatKey = isGroup ? remoteJid : senderJid;
                const sessionKey = `whatsapp-${chatKey.replace("@s.whatsapp.net", "").replace("@g.us", "-g")}`;

                // Abort any in-flight task for this chat
                const prevController = chatAbortControllers.get(chatKey);
                if (prevController) {
                    logger.info(`[abort] Aborting previous task for ${chatKey}`);
                    prevController.abort();
                }

                const controller = new AbortController();
                chatAbortControllers.set(chatKey, controller);

                // Queue per chat — serialise, never race
                const prev = chatQueues.get(chatKey) ?? Promise.resolve();
                const next = prev.then(() => {
                    if (controller.signal.aborted) return;
                    return handleMessage(
                        config, sock, remoteJid, senderJid, senderName, text, role, sessionKey, controller.signal
                    ).catch(async (err) => {
                        if (err instanceof Error && (err.name === "AbortError" || err.message?.includes("aborted"))) {
                            logger.info(`[abort] Task aborted for ${chatKey}`);
                            return;
                        }
                        logger.error(`Handler error for ${chatKey}:`, err);
                        await sock.sendMessage(remoteJid, {
                            text: "⚠️ Something went wrong. Please try again."
                        }).catch(() => { });
                    }).finally(() => {
                        if (chatAbortControllers.get(chatKey) === controller) {
                            chatAbortControllers.delete(chatKey);
                        }
                    });
                });
                chatQueues.set(chatKey, next);
            }
        });
    };

    await connectSocket();

    // Keep running forever
    await new Promise(() => { });
}

// ── Message handler ──────────────────────────────────────────────────────────
async function handleMessage(
    config: AppConfig,
    sock: ReturnType<typeof makeWASocket>,
    remoteJid: string,
    senderJid: string,
    senderName: string,
    text: string,
    role: "owner" | "user",
    sessionKey: string,
    abortSignal: AbortSignal,
): Promise<void> {
    // Save user message to history
    const userMsg: ModelMessage = {
        role: "user",
        content: text,
    };
    appendHistory(sessionKey, [userMsg]);

    // Load & prepare history
    const allHistory = prepareHistory(
        loadHistory(sessionKey),
        { tokenBudget: config.whatsapp?.historyTokenBudget ?? 12000 }
    );

    const roleTag = role === "owner" ? "OWNER" : "USER";
    const currentContent = `[${roleTag}] [${senderName}] ${text}`;
    const chatHistory = allHistory.slice(0, -1);

    // Show typing indicator
    await sock.sendPresenceUpdate("composing", remoteJid).catch(() => { });

    // Keep composing presence alive every 4s
    let composingActive = true;
    const composingLoop = (async () => {
        while (composingActive) {
            await sleep(4000);
            if (!composingActive) break;
            await sock.sendPresenceUpdate("composing", remoteJid).catch(() => { });
        }
    })();

    let responseText = "";

    try {
        const streamResult = await streamAgent(config, {
            userMessage: currentContent,
            chatHistory,
            role,
            meta: { channel: "whatsapp", chatId: remoteJid },
            abortSignal,
        });

        // Consume token stream
        for await (const token of streamResult.textStream) {
            responseText += token;
        }

        // Finalize
        const result = await streamResult.finalize();

        // Stop composing
        composingActive = false;
        await composingLoop;
        await sock.sendPresenceUpdate("paused", remoteJid).catch(() => { });

        // Check if aborted
        if (abortSignal.aborted) {
            logger.info(`[abort] Cleaning up aborted task for ${remoteJid}`);
            return;
        }

        const replyText = result.text?.trim();
        if (!replyText) {
            await sock.sendMessage(remoteJid, { text: "⚠️ No response from agent." }).catch(() => { });
            return;
        }

        // Send reply — split if over 4096 chars (WhatsApp supports 65536 but keep chunks readable)
        const MAX_LEN = 4096;
        if (replyText.length <= MAX_LEN) {
            await sock.sendMessage(remoteJid, { text: replyText }).catch(() => { });
        } else {
            const chunks = splitText(replyText, MAX_LEN);
            for (const chunk of chunks) {
                await sock.sendMessage(remoteJid, { text: chunk }).catch(() => { });
                await sleep(500); // Small delay between chunks
            }
        }

        // Save assistant response to history
        appendHistory(sessionKey, result.responseMessages);

    } catch (err) {
        composingActive = false;
        await composingLoop;
        await sock.sendPresenceUpdate("paused", remoteJid).catch(() => { });
        throw err; // Let caller handle
    }
}

// ── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Split text into chunks at paragraph or sentence boundaries. */
function splitText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        // Try to split at double newline
        let splitIdx = remaining.lastIndexOf("\n\n", maxLen);
        if (splitIdx < maxLen * 0.3) {
            // Try single newline
            splitIdx = remaining.lastIndexOf("\n", maxLen);
        }
        if (splitIdx < maxLen * 0.3) {
            // Try sentence boundary
            splitIdx = remaining.lastIndexOf(". ", maxLen);
            if (splitIdx > 0) splitIdx += 1;
        }
        if (splitIdx < maxLen * 0.3) {
            splitIdx = remaining.lastIndexOf(" ", maxLen);
        }
        if (splitIdx < 1) {
            splitIdx = maxLen;
        }

        chunks.push(remaining.slice(0, splitIdx).trimEnd());
        remaining = remaining.slice(splitIdx).trimStart();
    }

    return chunks;
}
