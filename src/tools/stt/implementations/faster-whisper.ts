// src/tools/stt/implementations/faster-whisper.ts — Faster Whisper for cross-platform

import { spawn } from 'node:child_process';
import fs from 'node:fs';

/**
 * Faster Whisper via Python CLI (fallback for non-Apple Silicon)
 */
export async function transcribeWithFasterWhisper(audioPath: string, language: string | null = null): Promise<string> {
  const pythonPath = process.env.PYTHON_PATH || 'python3';

  return new Promise((resolve, reject) => {
    const args = [
      '-c',
      `from faster_whisper import WhisperModel; model = WhisperModel("large-v3", device="auto"); segments, info = model.transcribe("${audioPath}", language="${language || 'auto'}"); text = "".join([segment.text for segment in segments]); print(text)`
    ];

    const child = spawn(pythonPath, args);
    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      console.error('Faster Whisper stderr:', data.toString());
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Faster Whisper exited with code ${code}`));
      }
    });
  });
}
