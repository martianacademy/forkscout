// src/channels/whatsapp/index.ts — WhatsApp Baileys channel
//
// Connection behavior matches WhatsApp Web exactly:
//   - Unregistered: ONE connection attempt. Server sends QR (refreshes ~5 times
//     within the same connection). If connection closes → STOP. User clicks
//     "Connect" again in dashboard (like Chrome's "Click to reload QR").
//   - Registered (already paired): auto-reconnect on disconnect with backoff.
//   - restartRequired (515): always auto-reconnect (pairing success flow).
//
// Pairing code flow: POST /api/whatsapp/connect { phoneNumber: "1234567890" }
// QR code flow:      POST /api/whatsapp/connect (no body)

import { getConfig, type AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { log } from "@/logs/logger.ts";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import {
    setWhatsAppConnected, setWhatsAppQR, resetWhatsAppState,
    setWhatsAppStarted, setWhatsAppPairingCode, getWhatsAppState,
} from "@/channels/whatsapp/state.ts";
import { initAuth } from "@/channels/whatsapp/auth.ts";
import { processIncomingMessages } from "@/channels/whatsapp/handle-message.ts";
import { sleep, sanitizePhoneNumber } from "@/channels/whatsapp/utils.ts";

const logger = log("whatsapp");

// Module-level phone number — set by startWhatsAppChannel when user wants pairing code
let pairingPhoneNumber: string | undefined;

export default {
    name: "whatsapp",
    start,
} satisfies Channel;

/** Check if WhatsApp credentials exist (i.e. device has been paired before). */
export function hasWhatsAppCredentials(): boolean {
    const config = getConfig();
    const sessionDir = resolve(process.cwd(), config.whatsapp?.sessionDir ?? ".agents/whatsapp-sessions");
    return existsSync(resolve(sessionDir, "creds.json"));
}

/** Start the WhatsApp channel. Pass phoneNumber for pairing code flow. Safe to call multiple times. */
export function startWhatsAppChannel(phoneNumber?: string): { ok: boolean; error?: string } {
    const state = getWhatsAppState();
    if (state.started) return { ok: true };

    if (phoneNumber) {
        pairingPhoneNumber = sanitizePhoneNumber(phoneNumber);
        if (pairingPhoneNumber.length < 7) {
            return { ok: false, error: "Phone number too short. Use full E.164 format without +." };
        }
    } else {
        pairingPhoneNumber = undefined;
    }

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
    const wa = config.whatsapp;
    const sessionDir = resolve(process.cwd(), wa?.sessionDir ?? ".agents/whatsapp-sessions");

    // Clean session dir for fresh pairing (like opening a new incognito tab)
    if (!hasWhatsAppCredentials()) {
        if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true, force: true });
    }
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    initAuth(config);
    setWhatsAppStarted();
    logger.info(`Starting WhatsApp channel (session: ${sessionDir})`);

    // Resolvable keep-alive: resolves when channel should stop (pairing failed / logged out).
    // For registered sessions this never resolves — channel runs forever.
    let stopChannel: () => void;
    const running = new Promise<void>((resolve) => { stopChannel = resolve; });

    const connectSocket = async (): Promise<void> => {
        const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);
        const isRegistered = authState.creds.registered;
        const usePairingCode = !!pairingPhoneNumber && !isRegistered;

        if (!isRegistered) {
            logger.info(usePairingCode
                ? `Connecting to WhatsApp (pairing code for ${pairingPhoneNumber})...`
                : "Connecting to WhatsApp (waiting for QR)...",
            );
        }

        const sock = makeWASocket({
            auth: authState,
            browser: Browsers.macOS("ForkScout"),
            getMessage: async (_key) => undefined,
        });

        sock.ev.on("creds.update", saveCreds);

        // ── Connection lifecycle ──────────────────────────────────────────
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Baileys emits `qr` multiple times (refreshes every ~20s, up to ~5 times)
            // within the SAME connection — just like WhatsApp Web.
            if (qr) {
                if (usePairingCode) {
                    try {
                        const code = await sock.requestPairingCode(pairingPhoneNumber!);
                        logger.info(`✓ Pairing code: ${code} — enter on your phone`);
                        setWhatsAppPairingCode(code);
                    } catch (err: any) {
                        logger.error(`✗ Failed to request pairing code: ${err.message}`);
                    }
                } else {
                    logger.info("QR code received — scan with WhatsApp");
                    await setWhatsAppQR(qr);
                }
            }

            if (connection === "open") {
                pairingPhoneNumber = undefined;
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
                pairingPhoneNumber = undefined;
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
