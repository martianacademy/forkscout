// src/tools/openai_tts_tools.ts — OpenAI TTS tool
import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export const IS_BOOTSTRAP_TOOL = false;

const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

export const openai_tts_tools = tool({
  description: "Convert text to speech using OpenAI TTS API (tts-1 or tts-1-hd)",
  inputSchema: z.object({
    text: z.string().describe("Text to convert to speech"),
    model: z.enum(["tts-1", "tts-1-hd"]).describe("TTS model - tts-1 is faster, tts-1-hd is higher quality").default("tts-1"),
    voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).describe("Voice: alloy, echo, fable, onyx, nova, shimmer").default("alloy")
  }),
  execute: async (input) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      const apiUrl = process.env.OPENAI_API_URL || DEFAULT_OPENAI_URL;
      
      if (!apiKey) {
        return { success: false, error: "OPENAI_API_KEY not set in .env" };
      }

      const response = await fetch(
        `${apiUrl}/audio/speech`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: input.model,
            voice: input.voice,
            input: input.text,
            response_format: "mp3"
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `OpenAI TTS error: ${response.status} - ${errorText}` };
      }

      // Get audio as buffer
      const audioBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(audioBuffer);

      // Save to temp file
      const tempDir = "/tmp/forkscout-tts";
      
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      const filename = `tts-${Date.now()}.mp3`;
      const filePath = join(tempDir, filename);
      
      writeFileSync(filePath, buffer);

      return {
        success: true,
        audio_path: filePath,
        duration_seconds: Math.round(buffer.length / 16000)
      };

    } catch (error: any) {
      return { success: false, error: error.message || "OpenAI TTS failed" };
    }
  }
});