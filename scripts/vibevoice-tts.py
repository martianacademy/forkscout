#!/usr/bin/env python3
"""
VibeVoice TTS generator — converts text to speech using VibeVoice-Realtime-0.5B.

Usage:
    python scripts/vibevoice-tts.py --text "Hello world" --output /tmp/hello.wav
    python scripts/vibevoice-tts.py --text "Hello world" --output /tmp/hello.ogg --voice Emma --format ogg

Voices: Carter, Davis, Emma, Frank, Grace, Mike (English)
        + multilingual: de-Spk0_man, fr-Spk1_woman, in-Samuel_man, jp-Spk0_man, etc.

Outputs WAV by default. Use --format ogg to get Telegram-compatible voice format.
"""

import argparse
import os
import sys
import time
import copy
import glob
import subprocess
import tempfile

import torch

# ── Voice discovery ─────────────────────────────────────

VOICES_DIR = os.path.join(os.path.dirname(__file__), "..", "vibevoice", "demo", "voices", "streaming_model")


def discover_voices() -> dict[str, str]:
    """Scan for all .pt voice files and return {name: path} dict."""
    voices = {}
    if not os.path.exists(VOICES_DIR):
        return voices
    for pt_file in glob.glob(os.path.join(VOICES_DIR, "**", "*.pt"), recursive=True):
        name = os.path.splitext(os.path.basename(pt_file))[0].lower()
        voices[name] = os.path.abspath(pt_file)
    return dict(sorted(voices.items()))


def resolve_voice(name: str, voices: dict[str, str]) -> str:
    """Fuzzy-match a voice name to a .pt file path."""
    lower = name.lower().strip()

    # Exact match
    if lower in voices:
        return voices[lower]

    # Try with en- prefix (convenience: "emma" → "en-emma_woman")
    for key, path in voices.items():
        # Match by the name part (before _man/_woman)
        base = key.split("_")[0]  # e.g. "en-emma"
        short = base.split("-")[-1] if "-" in base else base  # e.g. "emma"
        if lower == short or lower == base:
            return path

    # Partial match
    matches = [(k, p) for k, p in voices.items() if lower in k or k in lower]
    if len(matches) == 1:
        return matches[0][1]
    if len(matches) > 1:
        print(f"Warning: Multiple matches for '{name}': {[m[0] for m in matches]}. Using first.", file=sys.stderr)
        return matches[0][1]

    # Default to first English voice
    for k, p in voices.items():
        if k.startswith("en-"):
            print(f"Warning: No voice found for '{name}', using default: {k}", file=sys.stderr)
            return p

    # Absolute fallback
    first = list(voices.values())[0]
    print(f"Warning: No voice found for '{name}', using: {first}", file=sys.stderr)
    return first


# ── WAV → OGG Opus conversion ──────────────────────────

def wav_to_ogg_opus(wav_path: str, ogg_path: str) -> None:
    """Convert WAV to OGG Opus using ffmpeg (required for Telegram voice)."""
    cmd = [
        "ffmpeg", "-y", "-i", wav_path,
        "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1",
        ogg_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr[:500]}")


# ── Main TTS generation ────────────────────────────────

def generate(text: str, output_path: str, voice_name: str = "Emma",
             cfg_scale: float = 1.5, output_format: str = "wav") -> dict:
    """Generate speech from text and save to file. Returns metadata dict."""

    from vibevoice.modular.modeling_vibevoice_streaming_inference import (
        VibeVoiceStreamingForConditionalGenerationInference,
    )
    from vibevoice.processor.vibevoice_streaming_processor import VibeVoiceStreamingProcessor

    # Resolve device
    if torch.cuda.is_available():
        device = "cuda"
        load_dtype = torch.bfloat16
        attn_impl = "flash_attention_2"
    elif torch.backends.mps.is_available():
        device = "mps"
        load_dtype = torch.float32
        attn_impl = "sdpa"
    else:
        device = "cpu"
        load_dtype = torch.float32
        attn_impl = "sdpa"

    model_path = "microsoft/VibeVoice-Realtime-0.5B"

    # Discover and resolve voice
    voices = discover_voices()
    if not voices:
        raise FileNotFoundError(f"No voice files found in {VOICES_DIR}")
    voice_path = resolve_voice(voice_name, voices)
    print(f"Device: {device}, Voice: {os.path.basename(voice_path)}", file=sys.stderr)

    # Load processor and model
    processor = VibeVoiceStreamingProcessor.from_pretrained(model_path)

    try:
        if device == "mps":
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                model_path, torch_dtype=load_dtype, attn_implementation=attn_impl, device_map=None
            )
            model.to("mps")
        elif device == "cuda":
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                model_path, torch_dtype=load_dtype, device_map="cuda", attn_implementation=attn_impl
            )
        else:
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                model_path, torch_dtype=load_dtype, device_map="cpu", attn_implementation=attn_impl
            )
    except Exception as e:
        if attn_impl == "flash_attention_2":
            print(f"flash_attention_2 failed ({e}), falling back to SDPA", file=sys.stderr)
            model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                model_path, torch_dtype=load_dtype,
                device_map=(device if device != "mps" else None),
                attn_implementation="sdpa"
            )
            if device == "mps":
                model.to("mps")
        else:
            raise

    model.eval()
    model.set_ddpm_inference_steps(num_steps=5)

    # Load voice prompt
    all_prefilled = torch.load(voice_path, map_location=device, weights_only=False)

    # Prepare inputs
    clean_text = text.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    inputs = processor.process_input_with_cached_prompt(
        text=clean_text, cached_prompt=all_prefilled,
        padding=True, return_tensors="pt", return_attention_mask=True,
    )
    for k, v in inputs.items():
        if torch.is_tensor(v):
            inputs[k] = v.to(device)

    # Generate
    start_time = time.time()
    outputs = model.generate(
        **inputs, max_new_tokens=None, cfg_scale=cfg_scale,
        tokenizer=processor.tokenizer,
        generation_config={"do_sample": False}, verbose=False,
        all_prefilled_outputs=copy.deepcopy(all_prefilled),
    )
    gen_time = time.time() - start_time

    if not outputs.speech_outputs or outputs.speech_outputs[0] is None:
        raise RuntimeError("No audio output generated")

    # Calculate duration
    sample_rate = 24000
    audio_samples = outputs.speech_outputs[0].shape[-1]
    audio_duration = audio_samples / sample_rate

    # Save output
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    fmt = output_format.lower()
    if fmt == "ogg":
        # Save WAV to temp, then convert to OGG Opus
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_wav = tmp.name
        try:
            processor.save_audio(outputs.speech_outputs[0], output_path=tmp_wav)
            wav_to_ogg_opus(tmp_wav, output_path)
        finally:
            if os.path.exists(tmp_wav):
                os.unlink(tmp_wav)
    else:
        processor.save_audio(outputs.speech_outputs[0], output_path=output_path)

    result = {
        "output_path": output_path,
        "format": fmt,
        "voice": os.path.basename(voice_path),
        "duration_seconds": round(audio_duration, 2),
        "generation_seconds": round(gen_time, 2),
        "rtf": round(gen_time / audio_duration, 2) if audio_duration > 0 else 0,
        "device": device,
    }
    return result


# ── CLI ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VibeVoice TTS — text to speech")
    parser.add_argument("--text", type=str, required=True, help="Text to synthesize")
    parser.add_argument("--output", type=str, required=True, help="Output file path")
    parser.add_argument("--voice", type=str, default="Emma", help="Voice name (default: Emma)")
    parser.add_argument("--format", type=str, default="wav", choices=["wav", "ogg"], help="Output format")
    parser.add_argument("--cfg-scale", type=float, default=1.5, help="CFG scale (default: 1.5)")
    parser.add_argument("--list-voices", action="store_true", help="List available voices and exit")
    args = parser.parse_args()

    if args.list_voices:
        voices = discover_voices()
        for name in voices:
            print(name)
        return

    import json
    result = generate(args.text, args.output, voice_name=args.voice,
                      cfg_scale=args.cfg_scale, output_format=args.format)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
