# Speech-to-Text Tool

Universal STT tool for ForkScout.

## Platform Support

| Platform | Implementation | Speed |
|----------|---------------|-------|
| Apple Silicon Mac | mlx-whisper | ⚡ 4x faster |
| Mac Intel | faster-whisper | Fast |
| Linux/Windows | faster-whisper | Medium |

## Installation

### Apple Silicon Mac
```bash
pip install mlx-whisper
```

### Other Platforms
```bash
pip install faster-whisper
```

## Usage

```typescript
import { sttTool } from '@/tools/stt'

// Transcribe audio file
const result = await sttTool.execute({
  audio_path: '/path/to/audio.ogg',
  language: 'en',
  model_size: 'base',
  return_timestamps: false
})

// Result:
// {
//   success: true,
//   text: "Hello, how are you?",
//   language: "en",
//   confidence: 0.9,
//   platform: "apple-silicon",
//   model: "base"
// }
```

## Model Sizes

| Model | Memory | Accuracy |
|-------|--------|----------|
| tiny | ~75MB | Low |
| base | ~75MB | Medium |
| small | ~244MB | Good |
| medium | ~769MB | Better |
| large | ~1550MB | Best |
| large-v3 | ~1550MB | Best + multilingual |

## Telegram Voice

For voice messages, first download the audio file, then pass to STT tool.
