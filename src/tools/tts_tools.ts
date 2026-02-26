// src/tools/tts_tools.ts — ElevenLabs TTS tool (secure keychain version)
import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export const IS_BOOTSTRAP_TOOL = false;

// Default ElevenLabs API URL
const DEFAULT_ELEVENLABS_URL = "https://api.elevenlabs.io";
const KEYCHAIN_SERVICE = "forkscout-elevenlabs";

/**
 * Get secret from macOS Keychain (secure storage)
 */
function getKeychainPassword(service: string): string | null {
    try {
        return execSync(`security find-generic-password -wa "${service}"`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"]
        }).trim();
    } catch {
        return null;
    }
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
      // Get API key from macOS Keychain (secure storage)
      const apiKey = getKeychainPassword(KEYCHAIN_SERVICE);
      const apiUrl = process.env.ELEVENLABS_API_URL || DEFAULT_ELEVENLABS_URL;
      
      if (!apiKey) {
        return { success: false, error: "ElevenLabs API key not found in Keychain. Run: security add-generic-password -a 'forkscout-elevenlabs' -s 'ElevenLabs API Key for ForkScout' -w 'YOUR_KEY'" };
      }

      // Default voices based on language
      const defaultVoices: Record<string, string> = {
        en: "21m00Tcm4TlvDq8ikWAM",  // Rachel - default English
        hi: "fgYf3UF9HmX8QfJo3Qq7"   // Hindi voice
      };

      const voiceId = input.voice_id || defaultVoices[input.language || "en"];
      const model = "eleven_multilingual_v2";
      
      const response = await fetch(
        `${apiUrl}/v1/text-to-speech/${voiceId}`,
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