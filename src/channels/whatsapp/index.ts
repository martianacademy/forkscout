// src/channels/whatsapp/index.ts — WhatsApp Baileys channel
//
// Supports two pairing methods:
//   1. QR code (default) — scan from WhatsApp mobile
//   2. Pairing code — enter 8-digit code on phone (no QR needed, bypasses rate limits)
//
// Pairing code flow: POST /api/whatsapp/connect { phoneNumber: "1234567890" }
// QR code flow:      POST /api/whatsapp/connect (no body)

import { getConfig, type AppConfig } from "@/config.ts";
import type { Channel } from "@/channels/types.ts";
import { log } from "@/logs/logger.ts";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import {
    setWhatsAppConnected, setWhatsAppQR, setWhatsAppDisconnected,
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

    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    initAuth(config);
    setWhatsAppStarted();
    logger.info(`Starting WhatsApp channel (session: ${sessionDir})`);

    let retryCount = 0;
    const MAX_RETRIES = 10;
    let qrShown = false;

    const connectSocket = async (): Promise<void> => {
        // Re-read auth state from disk each attempt (picks up creds saved during pairing)
        const { state: authState, saveCreds } = await useMultiFileAuthState(sessionDir);
        const usePairingCode = !!pairingPhoneNumber && !authState.creds.registered;

        if (!authState.creds.registered) {
            logger.info(usePairingCode
                ? `No credentials — requesting pairing code for ${pairingPhoneNumber}`
                : "No credentials — starting QR code pairing flow...",
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

            // QR received — only relevant when NOT using pairing code
            if (qr && !usePairingCode) {
                qrShown = true;
                retryCount = 0;
                logger.info("QR code received — scan with WhatsApp mobile app");
                await setWhatsAppQR(qr);
            }

            if (connection === "close") {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                logger.warn(`Connection closed (reason: ${reason})`);

                if (reason === DisconnectReason.loggedOut) {
                    logger.error("Logged out — delete session and re-pair");
                    setWhatsAppDisconnected();
                    return;
                }

                // After successful pairing, WA sends restartRequired (515)
                if (reason === DisconnectReason.restartRequired) {
                    logger.info("Restart required (pairing success) — reconnecting with fresh creds...");
                    retryCount = 0;
                    qrShown = false;
                    pairingPhoneNumber = undefined;
                    await sleep(1000);
                    connectSocket();
                    return;
                }

                if (!authState.creds.registered) {
                    retryCount++;
                    if (qrShown || usePairingCode) {
                        if (retryCount > MAX_RETRIES) {
                            logger.error("Pairing timed out — restart to try again.");
                            setWhatsAppDisconnected();
                            return;
                        }
                        logger.info(`Pairing in progress — reconnecting in 2s (${retryCount}/${MAX_RETRIES})...`);
                        await sleep(2000);
                    } else {
                        if (retryCount > 3) {
                            logger.error("Server rejected attempts without QR — try pairing code with your phone number.");
                            setWhatsAppDisconnected();
                            return;
                        }
                        const delay = Math.min(5000 * Math.pow(2, retryCount - 1), 60_000);
                        logger.info(`No QR — retrying in ${Math.round(delay / 1000)}s (${retryCount}/3)...`);
                        await sleep(delay);
                    }
                } else {
                    retryCount = 0;
                    logger.info("Reconnecting in 3s...");
                    await sleep(3000);
                }
                connectSocket();
            } else if (connection === "open") {
                retryCount = 0;
                pairingPhoneNumber = undefined;
                logger.info("Connected to WhatsApp!");
                setWhatsAppConnected(sock.user?.id ?? "");
            }
        });

        // ── Incoming messages ─────────────────────────────────────────────
        sock.ev.on("messages.upsert", ({ messages, type }) => {
            if (type !== "notify") return;
            processIncomingMessages(sock, messages);
        });

        // ── Request pairing code AFTER event handlers are registered ──────
        if (usePairingCode) {
            try {
                const code = await sock.requestPairingCode(pairingPhoneNumber!);
                logger.info(`Pairing code: ${code} — enter this on your phone`);
                setWhatsAppPairingCode(code);
            } catch (err: any) {
                logger.error(`Failed to request pairing code: ${err.message}`);
            }
        }
    };

    await connectSocket();
    await new Promise(() => { }); // Keep running forever
}
