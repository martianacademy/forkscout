// src/tools/stt.ts — Universal speech-to-text tool
// Uses Whisper.cpp (native), MLX Whisper (Apple Silicon), or Faster Whisper (fallback)

import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";

// Import implementations
import { transcribeWithWhisperCpp } from "./stt/implementations/whisper-cpp.ts";
import { transcribeWithMlxWhisper } from "./stt/implementations/mlx-whisper.ts";
import { transcribeWithFasterWhisper } from "./stt/implementations/faster-whisper.ts";

/**
 * Transcribe audio to text using the best available STT engine
 */
export const speech_to_text = tool({
  description:
    "Transcribe audio to text using the best available STT engine (Whisper.cpp → MLX Whisper → Faster Whisper). Works on Apple Silicon Macs with native acceleration.",
  inputSchema: z.object({
    audioPath: z.string().describe("Absolute path to audio file (ogg, mp3, wav)"),
    language: z.string().optional().describe("Language code (e.g., en, hi). Auto-detect if null"),
  }),
  execute: async (input) => {
    // Validate file exists
    if (!fs.existsSync(input.audioPath)) {
      return `Error: Audio file not found at ${input.audioPath}`;
    }

    // Auto-detect platform and use best engine
    try {
      // 1. Try Whisper.cpp (Apple Silicon native)
      if (process.platform === 'darwin') {
        try {
          return await transcribeWithWhisperCpp(input.audioPath, input.language);
        } catch (e) {
          console.warn('Whisper.cpp failed, trying MLX Whisper:', e);
        }
      }

      // 2. Try MLX Whisper (Apple Silicon)
      if (process.platform === 'darwin') {
        try {
          return await transcribeWithMlxWhisper(input.audioPath, input.language);
        } catch (e) {
          console.warn('MLX Whisper failed, trying Faster Whisper:', e);
        }
      }

      // 3. Fallback to Faster Whisper (cross-platform)
      return await transcribeWithFasterWhisper(input.audioPath, input.language);
    } catch (err: unknown) {
      return `Error: ${(err as Error).message}. Install Whisper.cpp with: brew install whisper`;
    }
  },
});
