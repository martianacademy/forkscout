// path - src/tools/stt/implementations/mlx-whisper.ts
// Apple Silicon optimized using mlx-whisper

interface TranscribeOptions {
  audioPath: string
  language?: string
  model?: string
  returnTimestamps?: boolean
}

interface TranscribeResult {
  text: string
  language: string
  confidence: number
  timestamps?: Array<{ word: string; start: number; end: number }>
}

// Check if mlx-whisper is available
export async function transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
  // Dynamic import - mlx-whisper only works on Apple Silicon
  const mlxWhisper = await import('mlx-whisper').catch(() => null)
  
  if (!mlxWhisper) {
    throw new Error('mlx-whisper not installed. Run: pip install mlx-whisper')
  }
  
  const result = await mlxWhisper.transcribe(
    options.audioPath,
    {
      path: options.model || 'large-v3',
      language: options.language === 'auto' ? undefined : options.language,
      timestamps: options.returnTimestamps
    }
  )
  
  return {
    text: result.text || '',
    language: result.language || options.language || 'en',
    confidence: 0.9, // mlx-whisper doesn't provide confidence
    timestamps: options.returnTimestamps ? result.segments?.map((s: any) => ({
      word: s.text,
      start: s.start,
      end: s.end
    })) : undefined
  }
}
