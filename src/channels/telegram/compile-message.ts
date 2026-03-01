// src/channels/telegram/compile-message.ts — Compiles raw Telegram Message → ModelMessage (user role).
// Passes the full raw JSON from Telegram API as the message content.
// Zero maintenance — any new Telegram types/fields are automatically included.
//
// For plain text messages, sends just the text (no JSON overhead).
// For everything else, sends the full raw JSON object.

import type { Message } from "@grammyjs/types";
import type { ModelMessage } from "ai";

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Compile a raw Telegram Message into an AI SDK v6 `ModelMessage` (role: "user").
 *
 * Plain text → just the text string.
 * Everything else → full raw JSON from the Telegram API.
 */
export function compileTelegramMessage(rawMsg: Message): ModelMessage {
    return { role: "user", content: JSON.stringify(rawMsg) };
}
