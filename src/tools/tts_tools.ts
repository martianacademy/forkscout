// src/tools/tts_tools.ts — ElevenLabs TTS tool
import { tool } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

export const IS_BOOTSTRAP_TOOL = false;

// Load config for API key
function getConfig() {
  const configPath = join(process.cwd(), "src/forkscout.config.json");
  const configFile = readFileSync(configPath, "utf-8");
  return JSON.parse(configFile);
}

export const tts_tools = tool({
  description: "Convert text to speech using ElevenLabs TTS API and return audio file path.",
  inputSchema: z.object({
    text: z.string().describe("Text to convert to speech"),
    voice_id: z.string().describe("ElevenLabs voice ID").optional(),
    language: z.enum(["en", "hi"]).describe("Language: 'en' for English, 'hi' for Hindi").optional()
  }),
  execute: async (input) => {
    try {
      const config = getConfig();
      const apiKey = config.elevenlabsApiKey;
      
      if (!apiKey) {
        return { success: false, error: "ElevenLabs API key not configured in forkscout.config.json" };
      }

      // Default voices based on language
      const defaultVoices: Record<string, string> = {
        en: "21m00Tcm4TlvDq8ikWAM",  // Rachel - default English
        hi: "fgYf3UF9HmX8QfJo3Qq7"   // Hindi voice
      };

      const voiceId = input.voice_id || defaultVoices[input.language || "en"];
      const model = "eleven_multilingual_v2";
      
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey
          },
          body: JSON.stringify({
            text: input.text,
            model_id: model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `ElevenLabs API error: ${response.status} - ${errorText}` };
      }

      // Get audio as buffer
      const audioBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(audioBuffer);

      // Save to temp file with unique name
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
      return { success: false, error: error.message || "TTS conversion failed" };
    }
  }
});
