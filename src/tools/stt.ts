// path - src/tools/stt.ts
// Universal STT tool with Apple Silicon optimization

import { tool } from 'ai'
import { z } from 'zod'

// Platform detection
const isMac = process.platform === 'darwin'
const isAppleSilicon = isMac && process.arch === 'arm64'

export const speech_to_text = tool({
  description: `Convert audio to text using Whisper.\n    - On Apple Silicon Mac: Uses MLX for 4x faster inference\n    - On other platforms: Uses faster-whisper (CTranslate2)\n    - Supports: ogg, mp3, m4a, wav formats`,
  inputSchema: z.object({
    audio_path: z.string().describe('Path to audio file'),
    language: z.string().optional().describe('Language code (auto-detect if null)'),
    model_size: z.enum(['tiny', 'base', 'small', 'medium', 'large', 'large-v3']).optional().describe('Model size - larger = more accurate but slower')
  }),
  
  execute: async (args) => {
    const { audio_path, language = 'auto', model_size = 'base' } = args
    
    // Platform info
    const platform = isAppleSilicon ? 'apple-silicon' : isMac ? 'mac-intel' : 'linux/windows'
    
    // Import platform-specific implementation
    const transcribe = await import(
      isAppleSilicon 
        ? './stt/implementations/mlx-whisper.js'  
        : './stt/implementations/faster-whisper.js'
    ).then(m => m.transcribe)
    
    try {
      const result = await transcribe({
        audioPath: audio_path,
        language,
        model: model_size
      })
      
      return {
        success: true,
        text: result.text,
        language: result.language,
        confidence: result.confidence,
        platform,
        model: model_size
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Transcription failed',
        platform
      }
    }
  }
})

export default speech_to_text
