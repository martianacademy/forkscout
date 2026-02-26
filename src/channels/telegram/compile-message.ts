// src/channels/telegram/compile-message.ts
// Compiles a single raw Telegram Message object → ModelMessage (user role).
//
// Called per message before passing history to the LLM.
// Does NOT fetch file content from Telegram API — that is handled separately.
// Media types that require a download (photo, voice, etc.) produce a structured
// text description so the agent knows what arrived and can fetch if needed.

import type { Message } from "@grammyjs/types";
import type { ModelMessage } from "ai";

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Compile a raw Telegram Message into an AI SDK v6 `ModelMessage` (role: "user").
 *
 * @example
 * ```ts
 * const msg = compileTelegramMessage(rawMsg);
 * // { role: "user", content: "hello world" }
 * // { role: "user", content: "[photo: 1280x960 · caption: nice view]" }
 * // { role: "user", content: "[voice: 4s · ogg · file_id: ...]" }
 * ```
 */
export function compileTelegramMessage(rawMsg: Message): ModelMessage {
    const content = buildContent(rawMsg);
    return { role: "user", content };
}

// ─────────────────────────────────────────────
// Content builders
// ─────────────────────────────────────────────

function buildContent(msg: Message): string {
    // Reply context prepended inline (keeps the message self-contained for the LLM)
    const replyPrefix = buildReplyPrefix(msg);

    // ── Text ─────────────────────────────────────────────────────────────────
    if (msg.text) {
        return replyPrefix + msg.text;
    }

    // ── Photo ─────────────────────────────────────────────────────────────────
    if (msg.photo) {
        // Telegram sends multiple resolutions — use the largest (last entry)
        const best = msg.photo[msg.photo.length - 1];
        const dims = best.width && best.height ? ` · ${best.width}×${best.height}` : "";
        const size = best.file_size ? ` · ${formatBytes(best.file_size)}` : "";
        const cap = msg.caption ? ` · caption: ${msg.caption}` : "";
        return replyPrefix + `[photo${dims}${size}${cap} · file_id: ${best.file_id}]`;
    }

    // ── Voice ────────────────────────────────────────────────────────────────
    if (msg.voice) {
        const dur = msg.voice.duration ? ` · ${msg.voice.duration}s` : "";
        const mime = msg.voice.mime_type ? ` · ${msg.voice.mime_type}` : "";
        const size = msg.voice.file_size ? ` · ${formatBytes(msg.voice.file_size)}` : "";
        return replyPrefix + `[voice${dur}${mime}${size} · file_id: ${msg.voice.file_id}]`;
    }

    // ── Audio ────────────────────────────────────────────────────────────────
    if (msg.audio) {
        const title = msg.audio.title ? ` · "${msg.audio.title}"` : "";
        const artist = msg.audio.performer ? ` by ${msg.audio.performer}` : "";
        const dur = msg.audio.duration ? ` · ${msg.audio.duration}s` : "";
        const cap = msg.caption ? ` · caption: ${msg.caption}` : "";
        return replyPrefix + `[audio${title}${artist}${dur}${cap} · file_id: ${msg.audio.file_id}]`;
    }

    // ── Video ────────────────────────────────────────────────────────────────
    if (msg.video) {
        const dims = msg.video.width && msg.video.height ? ` · ${msg.video.width}×${msg.video.height}` : "";
        const dur = msg.video.duration ? ` · ${msg.video.duration}s` : "";
        const cap = msg.caption ? ` · caption: ${msg.caption}` : "";
        return replyPrefix + `[video${dims}${dur}${cap} · file_id: ${msg.video.file_id}]`;
    }

    // ── Video note (round video) ─────────────────────────────────────────────
    if (msg.video_note) {
        const dur = msg.video_note.duration ? ` · ${msg.video_note.duration}s` : "";
        return replyPrefix + `[video_note${dur} · file_id: ${msg.video_note.file_id}]`;
    }

    // ── Animation (GIF) ──────────────────────────────────────────────────────
    if (msg.animation) {
        const dims = msg.animation.width && msg.animation.height ? ` · ${msg.animation.width}×${msg.animation.height}` : "";
        const dur = msg.animation.duration ? ` · ${msg.animation.duration}s` : "";
        const cap = msg.caption ? ` · caption: ${msg.caption}` : "";
        return replyPrefix + `[animation${dims}${dur}${cap} · file_id: ${msg.animation.file_id}]`;
    }

    // ── Document ─────────────────────────────────────────────────────────────
    if (msg.document) {
        const name = msg.document.file_name ? ` · "${msg.document.file_name}"` : "";
        const mime = msg.document.mime_type ? ` · ${msg.document.mime_type}` : "";
        const size = msg.document.file_size ? ` · ${formatBytes(msg.document.file_size)}` : "";
        const cap = msg.caption ? ` · caption: ${msg.caption}` : "";
        return replyPrefix + `[document${name}${mime}${size}${cap} · file_id: ${msg.document.file_id}]`;
    }

    // ── Sticker ──────────────────────────────────────────────────────────────
    if (msg.sticker) {
        const emoji = msg.sticker.emoji ? ` ${msg.sticker.emoji}` : "";
        const set = msg.sticker.set_name ? ` · set: ${msg.sticker.set_name}` : "";
        const anim = msg.sticker.is_animated ? " · animated" : "";
        const video = msg.sticker.is_video ? " · video" : "";
        return replyPrefix + `[sticker${emoji}${set}${anim}${video}]`;
    }

    // ── Location ─────────────────────────────────────────────────────────────
    if (msg.location) {
        const lat = msg.location.latitude;
        const lon = msg.location.longitude;
        const acc = msg.location.horizontal_accuracy ? ` · ±${msg.location.horizontal_accuracy}m` : "";
        return replyPrefix + `[location: lat=${lat}, lon=${lon}${acc}]`;
    }

    // ── Venue ────────────────────────────────────────────────────────────────
    if (msg.venue) {
        return replyPrefix + `[venue: "${msg.venue.title}" · ${msg.venue.address} · lat=${msg.venue.location.latitude}, lon=${msg.venue.location.longitude}]`;
    }

    // ── Contact ──────────────────────────────────────────────────────────────
    if (msg.contact) {
        const name = [msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(" ");
        const phone = msg.contact.phone_number ? ` · ${msg.contact.phone_number}` : "";
        const user = msg.contact.user_id ? ` · userId: ${msg.contact.user_id}` : "";
        return replyPrefix + `[contact: ${name}${phone}${user}]`;
    }

    // ── Poll ─────────────────────────────────────────────────────────────────
    if (msg.poll) {
        const options = msg.poll.options.map((o) => o.text).join(" | ");
        const type = msg.poll.type === "quiz" ? " [quiz]" : "";
        return replyPrefix + `[poll${type}: "${msg.poll.question}" — ${options}]`;
    }

    // ── Dice ─────────────────────────────────────────────────────────────────
    if (msg.dice) {
        return replyPrefix + `[dice: ${msg.dice.emoji} rolled ${msg.dice.value}]`;
    }

    // ── Story ────────────────────────────────────────────────────────────────
    if (msg.story) {
        return replyPrefix + `[story shared]`;
    }

    // ── Game ─────────────────────────────────────────────────────────────────
    if (msg.game) {
        const title = msg.game.title ? ` · "${msg.game.title}"` : "";
        return replyPrefix + `[game${title}]`;
    }

    // ── Paid media ───────────────────────────────────────────────────────────
    if (msg.paid_media) {
        const cap = msg.caption ? ` · caption: ${msg.caption}` : "";
        return replyPrefix + `[paid_media${cap}]`;
    }

    // Fallback — should not happen if hasContent() guard is working
    return replyPrefix + `[unsupported message type]`;
}

// ─────────────────────────────────────────────
// Reply context
// ─────────────────────────────────────────────

/**
 * If the message is a reply, prepend a short context line so the LLM
 * knows what was being responded to.
 *
 * Format:
 *   "[replying to: <preview>]\n"
 */
function buildReplyPrefix(msg: Message): string {
    const reply = msg.reply_to_message;
    if (!reply) return "";

    let preview = "";
    if (reply.text) {
        preview = reply.text.slice(0, 80) + (reply.text.length > 80 ? "…" : "");
    } else if (reply.caption) {
        preview = reply.caption.slice(0, 80) + (reply.caption.length > 80 ? "…" : "");
    } else if (reply.sticker?.emoji) {
        preview = `sticker ${reply.sticker.emoji}`;
    } else if (reply.photo) {
        preview = "photo";
    } else if (reply.voice) {
        preview = "voice message";
    } else if (reply.audio) {
        preview = "audio";
    } else if (reply.video) {
        preview = "video";
    } else if (reply.document) {
        preview = reply.document.file_name ?? "document";
    } else {
        preview = "message";
    }

    // Was it a reply to the bot itself (no from, or from a bot)?
    const toBot = reply.from?.is_bot === true;
    const label = toBot ? "replying to bot" : "replying to";

    return `[${label}: ${preview}]\n`;
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
