// path - src/tools/stt/implementations/faster-whisper.ts
// Cross-platform using faster-whisper (CTranslate2)

import { existsSync } from 'fs'

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

export async function transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
  const { FasterWhisper } = await import('faster-whisper').catch(() => {
    throw new Error('faster-whisper not installed. Run: pip install faster-whisper')
  })
  
  // Validate file exists
  if (!existsSync(options.audioPath)) {
    throw new Error(`Audio file not found: ${options.audioPath}`)
  }
  
  // Map model size
  const modelSize = options.model || 'base'
  const computeType = process.env.STREAM_MODE === 'true' ? 'int8' : 'float16'
  const device = process.platform === 'darwin' ? 'cuda' : 'cpu'
  
  const whisper = new FasterWhisper(modelSize, {
    compute_type: computeType,
    device
  })
  
  const segments = await whisper.transcribe(options.audioPath, {
    language: options.language === 'auto' ? undefined : options.language,
    vad_filter: true,
    word_timestamps: options.returnTimestamps || false
  })
  
  let fullText = ''
  let language = options.language || 'en'
  const timestamps: TranscribeResult['timestamps'] = []
  
  for await (const segment of segments) {
    fullText += segment.text + ' '
    
    if (options.returnTimestamps && segment.words) {
      for (const word of segment.words) {
        timestamps.push({
          word: word.word,
          start: word.start,
          end: word.end
        })
      }
    }
  }
  
  return {
    text: fullText.trim(),
    language,
    confidence: 0.85,
    timestamps: options.returnTimestamps ? timestamps : undefined
  }
}
