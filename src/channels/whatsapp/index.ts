// src/channels/whatsapp/index.ts — WhatsApp Baileys channel
// Unregistered: single attempt, no retry. Registered: auto-reconnect.
// QR pairing: POST /api/whatsapp/connect

import { getConfig, type AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { log } from "@/logs/logger.ts";
import {
    makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers,
    fetchLatestBaileysVersion, makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { makeSilentLogger } from "@/channels/whatsapp/baileys-logger.ts";
import {
    setWhatsAppConnected, setWhatsAppQR, resetWhatsAppState,
    setWhatsAppStarted, getWhatsAppState, setActiveSock,
} from "@/channels/whatsapp/state.ts";
import { initAuth } from "@/channels/whatsapp/auth.ts";
import { processIncomingMessages } from "@/channels/whatsapp/handle-message.ts";
import { sleep } from "@/channels/whatsapp/utils.ts";

const logger = log("whatsapp");

export default {
    name: "whatsapp",
    start,
} satisfies Channel;

/** Check if WhatsApp credentials exist (i.e. device has been paired before). */
export function hasWhatsAppCredentials(): boolean {
    const config = getConfig();
    const sessionDir = resolve(process.cwd(), config.channels.whatsapp?.sessionDir ?? ".agents/whatsapp-sessions");
    return existsSync(resolve(sessionDir, "creds.json"));
}

/** Start the WhatsApp channel. Safe to call multiple times. */
export function startWhatsAppChannel(): { ok: boolean; error?: string } {
    const state = getWhatsAppState();
    if (state.started) return { ok: true };

    try {
        const config = getConfig();
        start(config);
        return { ok: true };
    } catch (err: any) {
        return { ok: false, error: err.message };
    }
}

// ── Main channel ─────────────────────────────────────────────────────────────
async function start(config: AppConfig): Promise<void> {
    const wa = config.channels.whatsapp;
    const sessionDir = resolve(process.cwd(), wa?.sessionDir ?? ".agents/whatsapp-sessions");

    // Ensure session dir exists (never delete — creds must persist across restarts)
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    initAuth(config);
    setWhatsAppStarted();
    logger.info(`Starting WhatsApp channel (session: ${sessionDir})`);

    // Resolvable keep-alive: resolves when channel should stop (pairing failed / logged out).
    // For registered sessions this never resolves — channel runs forever.
    let stopChannel: () => void;
    const running = new Promise<void>((resolve) => { stopChannel = resolve; });

    const { version } = await fetchLatestBaileysVersion();
    logger.info(`WA version ${version.join(".")}, session: ${sessionDir}`);

    const connectSocket = async (): Promise<void> => {
        const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);
        const isRegistered = authState.creds.registered;

        if (!isRegistered) {
            logger.info("Connecting to WhatsApp (waiting for QR)...");
        }

        const baileysLogger = makeSilentLogger();
        const sock = makeWASocket({
            auth: {
                creds: authState.creds,
                keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
            },
            version,
            logger: baileysLogger,
            browser: Browsers.macOS("ForkScout"),
            syncFullHistory: false,
            markOnlineOnConnect: false,
            getMessage: async (_key) => undefined,
        });

        setActiveSock(sock);

        // Handle WebSocket-level errors (prevent unhandled crashes)
        if (sock.ws && typeof (sock.ws as any).on === "function") {
            (sock.ws as any).on("error", (err: Error) => {
                logger.error(`WebSocket error: ${err.message}`);
            });
        }

        sock.ev.on("creds.update", saveCreds);

        // ── Connection lifecycle ──────────────────────────────────────────
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Baileys emits `qr` multiple times (refreshes every ~20s, up to ~5 times)
            // within the SAME connection — just like WhatsApp Web.
            if (qr) {
                logger.info("QR code received — scan with WhatsApp");
                await setWhatsAppQR(qr);
            }

            if (connection === "open") {
                logger.info("✓ Connected to WhatsApp!");
                setWhatsAppConnected(sock.user?.id ?? "");
                return;
            }

            if (connection !== "close") return;

            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            logger.warn(`Connection closed (reason: ${reason})`);

            // ── restartRequired (515) — pairing succeeded, auto-reconnect ──
            if (reason === DisconnectReason.restartRequired) {
                logger.info("Restart required (pairing success) — reconnecting...");
                await sleep(1000);
                connectSocket();
                return;
            }

            // ── loggedOut — stop, user must re-pair ────────────────────────
            if (reason === DisconnectReason.loggedOut) {
                logger.error("Logged out — delete session and re-pair.");
                resetWhatsAppState();
                stopChannel!(); // let start() complete — no zombie
                return;
            }

            // ── UNREGISTERED: single attempt, no auto-retry ────────────────
            // Just like WhatsApp Web: if QR expired or server rejected us,
            // stop and let the user click Connect again.
            if (!isRegistered) {
                logger.info("Connection closed during pairing — click Connect to try again.");
                resetWhatsAppState(); // sets started=false so Connect button reappears
                stopChannel!(); // let start() complete — no zombie
                return;
            }

            // ── REGISTERED: auto-reconnect with backoff ────────────────────
            const delay = Math.min(3000 * Math.pow(1.5, Math.min(retryCount, 8)), 60_000);
            retryCount++;
            logger.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${retryCount})...`);
            await sleep(delay);
            connectSocket();
        });

        // ── Incoming messages ─────────────────────────────────────────────
        sock.ev.on("messages.upsert", ({ messages, type }) => {
            if (type !== "notify") return;
            processIncomingMessages(sock, messages);
        });
    };

    let retryCount = 0;
    await connectSocket();
    await running; // blocks until stopChannel() or forever for registered sessions
}
