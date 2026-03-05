// src/channels/telegram/compile-message.ts — Compiles raw Telegram Message → ModelMessage (user role).
// Passes the full raw JSON from Telegram API as the message content.
// Zero maintenance — any new Telegram types/fields are automatically included.
//
// For plain text messages, sends just the text (no JSON overhead).
// For voice messages, automatically downloads, transcribes, and includes text.
// For everything else, sends the full raw JSON object.

import type { Message } from "@grammyjs/types";
import type { ModelMessage } from "ai";
import { getFile, downloadFile } from "@/channels/telegram/api.ts";
import { log } from "@/logs/logger.ts";

const logger = log("telegram/compile-message");

/**
 * Compile a raw Telegram Message into an AI SDK v6 `ModelMessage` (role: "user").
 *
 * Plain text → just the text string.
 * Voice message → download, transcribe, return transcription text.
 * Everything else → full raw JSON from the Telegram API.
 */
export async function compileTelegramMessage(rawMsg: Message, token: string): Promise<ModelMessage> {
    // Text message - just return the text
    if (rawMsg.text) {
        return { role: "user", content: rawMsg.text };
    }

    // Voice message - download and transcribe
    if (rawMsg.voice) {
        try {
            const file = await getFile(token, rawMsg.voice.file_id);
            if (!file?.file_path) {
                logger.warn("compileTelegramMessage: could not get file path for voice");
                return { role: "user", content: "[Voice message - could not download]" };
            }
            const audioData = await downloadFile(token, file.file_path);
            if (!audioData) {
                logger.warn("compileTelegramMessage: could not download voice file");
                return { role: "user", content: "[Voice message - could not download]" };
            }
            // Save to temp file for STT tool
            const tempPath = `/tmp/voice_${rawMsg.message_id}.ogg`;
            await Bun.write(tempPath, audioData);
            // Transcribe using the speech_to_text tool
            const transcription = await transcribeAudio(tempPath);
            logger.info(`Voice transcribed: ${transcription.substring(0, 50)}...`);
            return { role: "user", content: transcription };
        } catch (err) {
            logger.error("compileTelegramMessage: voice transcription failed:", err);
            return { role: "user", content: "[Voice message - transcription failed]" };
        }
    }

    // Everything else - return full JSON
    return { role: "user", content: JSON.stringify(rawMsg) };
}

/**
 * Transcribe audio file using Python STT tools.
 * Tries MLX Whisper (Apple Silicon) first, falls back to Faster Whisper.
 */
async function transcribeAudio(filePath: string): Promise<string> {
    // Try mlx-whisper first (Apple Silicon optimized)
    try {
        const proc = Bun.spawnSync(["python3", "-c", `import mlx_whisper; print(mlx_whisper.transcribe("${filePath}")["text"])`]);
        const text = proc.stdout.toString().trim();
        if (text) return text;
    } catch { /* mlx-whisper not available, try faster-whisper */ }

    // Fallback to faster-whisper
    try {
        const proc = Bun.spawnSync(["python3", "-c", `from faster_whisper import WhisperModel; m = WhisperModel("small", device="cpu", compute_type="int8"); print(list(m.transcribe("${filePath}"))[0].text)`]);
        const text = proc.stdout.toString().trim();
        if (text) return text;
    } catch { /* faster-whisper not available */ }

    return "[Voice message - no STT installed. Run: pip install mlx-whisper]";
}