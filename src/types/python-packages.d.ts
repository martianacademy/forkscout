// Type declarations for Python packages used via dynamic import
declare module 'mlx-whisper' {
  export function transcribe(
    audioPath: string,
    options?: {
      path?: string
      language?: string
      timestamps?: boolean
    }
  ): Promise<{
    text: string
    language: string
    segments?: Array<{ text: string; start: number; end: number }>
  }>
}

declare module 'faster-whisper' {
  export class FasterWhisper {
    constructor(model: string, options?: {
      compute_type?: string
      device?: string
    })
    
    transcribe(
      audioPath: string,
      options?: {
        language?: string
        vad_filter?: boolean
        word_timestamps?: boolean
      }
    ): AsyncGenerator<{
      text: string
      words?: Array<{ word: string; start: number; end: number }>
    }>
  }
}
