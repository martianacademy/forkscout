// src/channels/telegram/compile-message.ts — Compiles raw Telegram Message → ModelMessage (user role).
// Zero maintenance — any new Telegram types/fields are automatically included.
//
// Plain text → sends just the text string.
// Everything else → sends the full raw JSON object so the agent can inspect and act on it.

import type { Message } from "@grammyjs/types";
import type { ModelMessage } from "ai";

/**
 * Compile a raw Telegram Message into an AI SDK v6 `ModelMessage` (role: "user").
 *
 * Plain text → just the text string.
 * Everything else (voice, photo, document, sticker, …) → full raw JSON.
 * The agent reads the raw object and uses appropriate tools to process it.
 */
export function compileTelegramMessage(rawMsg: Message): ModelMessage {
    if (rawMsg.text) {
        return { role: "user", content: rawMsg.text };
    }

    return { role: "user", content: JSON.stringify(rawMsg) };
}