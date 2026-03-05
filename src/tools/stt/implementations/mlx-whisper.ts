// src/tools/stt/implementations/mlx-whisper.ts — MLX Whisper for Apple Silicon (no Python)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * MLX Whisper native transcription
 * Uses Apple Silicon Metal acceleration via mlx-whisper CLI
 */
export async function transcribeWithMlxWhisper(audioPath: string, language: string | null = null): Promise<string> {
  const mlxWhisperPath = '/opt/homebrew/bin/mlx_whisper';

  if (!fs.existsSync(mlxWhisperPath)) {
    throw new Error('MLX Whisper not found. Install with: pip install mlx-whisper');
  }

  return new Promise((resolve, reject) => {
    const args = ['--model', 'large', '--language', language || 'en', audioPath];

    const child = spawn(mlxWhisperPath, args);
    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      console.error('MLX Whisper stderr:', data.toString());
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`MLX Whisper exited with code ${code}`));
      }
    });
  });
}
