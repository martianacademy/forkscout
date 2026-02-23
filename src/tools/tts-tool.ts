/**
 * VibeVoice TTS tool — generate high-quality speech using VibeVoice-Realtime-0.5B.
 *
 * Supports multiple voices (English + multilingual), outputs WAV or OGG (Telegram voice).
 * Runs on MPS (Apple Silicon), CUDA, or CPU.
 *
 * @module tools/tts-tool
 */
import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve as resolvePath, join } from 'path';
import { PROJECT_ROOT } from '../paths';
import { withAccess } from './access';

const VENV_PYTHON = resolvePath(PROJECT_ROOT, 'vibevoice_setup/venv/bin/python');
const TTS_SCRIPT = resolvePath(PROJECT_ROOT, 'scripts/vibevoice-tts.py');
const TMP_DIR = resolvePath(PROJECT_ROOT, 'tmp/tts');

// Pre-create tmp dir
if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Generate speech from text using VibeVoice-Realtime-0.5B.
 */
export const ttsGenerateVoice = withAccess('guest', tool({
    description: `Generate a voice/TTS audio file using VibeVoice-Realtime-0.5B (Microsoft's open-source frontier TTS model).

Produces natural, expressive speech with ~200ms first-audible latency on Apple Silicon.

Voices (English):
  - Emma (woman, default) — clear, warm
  - Grace (woman) — expressive
  - Carter (man) — professional
  - Davis (man) — deep
  - Frank (man) — conversational
  - Mike (man) — energetic

Multilingual voices: de-Spk0_man, de-Spk1_woman, fr-Spk0_man, fr-Spk1_woman,
  in-Samuel_man, it-Spk0_woman, jp-Spk0_man, kr-Spk0_woman, etc.

Output formats:
  - wav: High-quality uncompressed (default)
  - ogg: Compressed Opus — use this for sending as Telegram voice message

After generating with format "ogg", use send_telegram_voice to send it as a voice message.`,
    inputSchema: z.object({
        text: z.string().describe('The text to synthesize into speech. Works best with 4+ words. English recommended.'),
        voice: z.string().default('Emma').describe('Voice name (e.g. "Emma", "Carter", "Grace", "Davis", "Frank", "Mike")'),
        format: z.enum(['wav', 'ogg']).default('ogg').describe('Output format: "wav" for quality, "ogg" for Telegram voice messages'),
        outputPath: z.string().optional().describe('Custom output path (optional — auto-generated if not provided)'),
    }),
    execute: async ({ text, voice, format, outputPath }): Promise<string> => {
        // Validate setup
        if (!existsSync(VENV_PYTHON)) {
            return `TOOL ERROR [tts_generate_voice]: VibeVoice venv not found at ${VENV_PYTHON}. Run: python3 -m venv vibevoice_setup/venv && source vibevoice_setup/venv/bin/activate && cd vibevoice && pip install -e ".[streamingtts]"`;
        }
        if (!existsSync(TTS_SCRIPT)) {
            return `TOOL ERROR [tts_generate_voice]: TTS script not found at ${TTS_SCRIPT}`;
        }

        // Resolve output path
        const ext = format === 'ogg' ? '.ogg' : '.wav';
        const outPath = outputPath
            ? resolvePath(outputPath)
            : join(TMP_DIR, `voice_${Date.now()}${ext}`);

        return new Promise((resolvePromise) => {
            const args = [
                TTS_SCRIPT,
                '--text', text,
                '--output', outPath,
                '--voice', voice,
                '--format', format,
            ];

            const env = {
                ...process.env,
                PYTHONPATH: join(PROJECT_ROOT, 'vibevoice'),
            };

            execFile(VENV_PYTHON, args, {
                cwd: PROJECT_ROOT,
                env,
                timeout: 120_000, // 2 minute timeout
                maxBuffer: 10 * 1024 * 1024,
            }, (error, stdout, stderr) => {
                if (error) {
                    const errMsg = stderr?.slice(-500) || error.message;
                    console.error(`[TTS]: VibeVoice error: ${errMsg}`);
                    resolvePromise(`TOOL ERROR [tts_generate_voice]: ${errMsg}`);
                    return;
                }

                try {
                    const result = JSON.parse(stdout.trim());
                    console.log(`[TTS]: Generated ${result.duration_seconds}s audio in ${result.generation_seconds}s (RTF: ${result.rtf}x, voice: ${result.voice})`);
                    resolvePromise(`Voice generated successfully.\nFile: ${result.output_path}\nFormat: ${result.format}\nDuration: ${result.duration_seconds}s\nVoice: ${result.voice}\nGeneration time: ${result.generation_seconds}s\n\nTo send as a Telegram voice message, use send_telegram_voice with this file path.`);
                } catch {
                    // stdout might not be JSON if there's extra logging
                    if (existsSync(outPath)) {
                        resolvePromise(`Voice generated successfully at ${outPath}. Use send_telegram_voice to send it.`);
                    } else {
                        resolvePromise(`TOOL ERROR [tts_generate_voice]: Generation may have failed. stdout: ${stdout?.slice(-300)}`);
                    }
                }
            });
        });
    },
}));
