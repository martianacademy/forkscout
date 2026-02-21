# Copilot Bridge

VS Code extension that exposes Copilot-hosted models as an OpenAI-compatible HTTP API.

## What it does

Starts a local HTTP server (default port 4000) that translates OpenAI Chat Completions API requests into VS Code's `vscode.lm` API calls. This lets any OpenAI-compatible client (Forkscout, curl, etc.) use models from your GitHub Copilot subscription — **at zero additional API cost**.

## Available models

Whatever your Copilot subscription provides:

- Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
- GPT-4o, GPT-4o-mini, o1, o3
- Gemini Pro, Flash
- etc.

Run `GET http://localhost:4000/v1/models` to see what's available.

## Setup

### Install as extension

```bash
cd copilot-bridge
pnpm install
pnpm build
pnpm package
code --install-extension copilot-bridge-0.1.0.vsix
```

### Or dev mode

Open the `copilot-bridge/` folder in VS Code and press F5.

### First use

On the first API call, VS Code will show a consent dialog asking you to allow the extension to use language models. Click **Allow**.

## Use with Forkscout

1. Set provider in `forkscout.config.json`:

```json
{ "provider": "copilot-bridge" }
```

2. The bridge auto-starts when VS Code opens. Forkscout connects to `http://localhost:4000/v1`.

3. Override port: set `COPILOT_BRIDGE_URL=http://localhost:5000/v1` in `.env`

## API endpoints

| Method | Path                   | Description                          |
| ------ | ---------------------- | ------------------------------------ |
| GET    | `/health`              | Health check                         |
| GET    | `/v1/models`           | List available Copilot models        |
| POST   | `/v1/chat/completions` | Chat completions (stream + standard) |

## Supported features

- ✅ Chat completions (text in/out)
- ✅ Tool calling (function calling with JSON schemas)
- ✅ Streaming (SSE) and non-streaming
- ✅ Multi-turn conversations
- ✅ System messages (prepended to first user message)
- ❌ Embeddings (not available via vscode.lm)
- ❌ Vision/images (not available via vscode.lm)

## Settings

| Setting                   | Default | Description                     |
| ------------------------- | ------- | ------------------------------- |
| `copilotBridge.port`      | 4000    | HTTP server port                |
| `copilotBridge.autoStart` | true    | Start server when VS Code opens |

## Limitations

- **Requires VS Code to be running** — no headless or server deployment
- **Rate limits** — Copilot may throttle heavy usage
- **Consent dialog** — first use shows a permission prompt per model
- **Model availability** — depends on your Copilot subscription tier
