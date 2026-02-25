# Quick Start Guide

Get Forkscout up and running in minutes!

## Prerequisites

- Node.js 22.x or higher
- pnpm 10.x or higher
- Ollama (or OpenAI API key)

## Installation

1. **Clone the repository**

    ```bash
    git clone https://github.com/yourusername/forkscout.git
    cd forkscout
    ```

2. **Install dependencies**

    ```bash
    pnpm install
    ```

3. **Configure environment**

    ```bash
    cp .env.example .env
    # Edit .env with your settings
    ```

4. **Build packages**
    ```bash
    pnpm build
    ```

## Running the Agent

### Interactive CLI Mode

```bash
pnpm dev
```

This starts the agent in interactive mode. You can chat with it directly in the terminal.

### Programmatic Usage

```typescript
import { createAgent } from '@forkscout/agent';

const agent = await createAgent({
    llm: {
        provider: 'ollama',
        model: 'qwen2.5-coder:32b',
        baseURL: 'http://localhost:11434/v1',
    },
});

const response = await agent.processMessage('Search for Bitcoin news');
console.log(response);
```

## Running the Agent Server

```bash
pnpm serve
```

The agent API runs at http://localhost:3210

If `TELEGRAM_BOT_TOKEN` is set in `.env`, the Telegram bridge auto-starts.

## Using with Docker (OpenClaw Environment)

If you want to run Forkscout in the same environment as OpenClaw:

1. **Access Ollama from Docker**

    Use `host.docker.internal:11434` as the LLM base URL:

    ```typescript
    baseURL: 'http://host.docker.internal:11434/v1';
    ```

2. **Use SearXNG for web search**

    If SearXNG is running in Docker Compose:

    ```bash
    SEARXNG_URL=http://searxng:8888
    ```

3. **Mount workspace**

    Add to docker-compose.yml:

    ```yaml
    volumes:
        - ./forkscout:/workspace/forkscout
    ```

## Examples

Run the example scripts:

```bash
# Basic usage
tsx examples/basic.ts

# Custom tools
tsx examples/custom-tools.ts
```

## Common Commands

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Run agent in dev mode
pnpm dev

# Run agent server
pnpm serve

# Clean build artifacts
pnpm clean

# Run tests
pnpm test
```

## Troubleshooting

### "Cannot connect to Ollama"

Make sure Ollama is running:

```bash
ollama serve
```

Test the connection:

```bash
curl http://localhost:11434/v1/models
```

### "Module not found"

Rebuild the project:

```bash
pnpm clean
pnpm install
pnpm build
```

## Next Steps

- Read the [Architecture Documentation](./docs/architecture.md) (coming soon)
- Check out [Custom Tools Guide](./docs/tools.md) (coming soon)
- Explore [Memory & RAG](./docs/memory.md) (coming soon)

## Getting Help

- GitHub Issues: https://github.com/yourusername/forkscout/issues
- Discussions: https://github.com/yourusername/forkscout/discussions
