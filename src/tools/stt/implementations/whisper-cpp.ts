// src/tools/stt/implementations/whisper-cpp.ts — Whisper.cpp native implementation for Apple Silicon

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Whisper.cpp native transcription (no Python)
 * Uses llama.cpp’s optimized whisper implementation
 */
export async function transcribeWithWhisperCpp(audioPath: string, language: string | null = null): Promise<string> {
  const whisperCppPath = '/usr/local/bin/whisper'; // Default install path

  if (!fs.existsSync(whisperCppPath)) {
    throw new Error('Whisper.cpp not found. Install with: brew install whisper');
  }

  const modelPath = path.join(path.dirname(whisperCppPath), 'models', 'ggml-base.en.bin');
  if (!fs.existsSync(modelPath)) {
    throw new Error('Whisper model not found. Run: wget https://ggml.com/models/whisper/ggml-base.en.bin -O ' + modelPath);
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', audioPath,
      '-otxt'
    ];

    if (language) {
      args.push('-l', language);
    }

    const child = spawn(whisperCppPath, args);
    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      console.error('Whisper.cpp stderr:', data.toString());
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`Whisper.cpp exited with code ${code}`));
      }
    });
  });
}
