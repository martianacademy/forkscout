// src/providers/elevenlabs_provider.ts — ElevenLabs TTS/STT provider via @ai-sdk/elevenlabs.
// ElevenLabs provider using the official @ai-sdk/elevenlabs package.
//
// ⚠️  ElevenLabs provides SPEECH (TTS) and TRANSCRIPTION (STT) — NOT language models.
//     It is NOT registered in the LLM provider registry.
//     Use the helpers below for speech and transcription tasks.
//
// Speech models:   eleven_v3, eleven_multilingual_v2, eleven_flash_v2_5,
//                  eleven_flash_v2, eleven_turbo_v2_5, eleven_turbo_v2,
//                  eleven_monolingual_v1, eleven_multilingual_v1
//
// Transcription:   scribe_v1, scribe_v1_experimental
//
// Docs: https://ai-sdk.dev/providers/ai-sdk-providers/elevenlabs

import { createElevenLabs } from "@ai-sdk/elevenlabs";

/**
 * Creates an ElevenLabs provider instance.
 *
 * @param apiKey - Optional API key. Falls back to ELEVENLABS_API_KEY env var.
 */
export function createElevenLabsProvider(apiKey?: string) {
    return createElevenLabs({
        apiKey: apiKey ?? process.env.ELEVENLABS_API_KEY ?? "",
    });
}

/**
 * Returns an ElevenLabs speech model for use with experimental_generateSpeech().
 *
 * @param modelId - Speech model ID. Defaults to "eleven_multilingual_v2".
 *
 * Usage:
 *   import { experimental_generateSpeech as generateSpeech } from "ai";
 *   const result = await generateSpeech({
 *     model: getElevenLabsSpeechModel("eleven_flash_v2_5"),
 *     text: "Hello, world!",
 *     voice: "21m00Tcm4TlvDq8ikWAM", // Rachel — voice ID from ElevenLabs Voice Library
 *   });
 */
export function getElevenLabsSpeechModel(modelId: string = "eleven_multilingual_v2") {
    return createElevenLabsProvider().speech(modelId);
}

/**
 * Returns an ElevenLabs transcription model for use with experimental_transcribe().
 *
 * @param modelId - Transcription model ID. Defaults to "scribe_v1".
 *
 * Usage:
 *   import { experimental_transcribe as transcribe } from "ai";
 *   const result = await transcribe({
 *     model: getElevenLabsTranscriptionModel(),
 *     audio: audioBuffer,
 *   });
 */
export function getElevenLabsTranscriptionModel(modelId: string = "scribe_v1") {
    return createElevenLabsProvider().transcription(modelId);
}
