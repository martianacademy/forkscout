# 💬 How to Chat with Forkscout

## Quick Start (Easiest Way)

From the project root, run:

```bash
./chat.sh
```

Or run directly:

```bash
pnpm start
```

## Configuration

### 1. Check Your LLM Connection

The agent is configured in [.env](/.env) file:

```bash
LLM_PROVIDER=ollama
LLM_MODEL=deepseek-r1:1.5b
LLM_BASE_URL=http://localhost:11434/v1
```

**Your available Ollama models:**

- `deepseek-r1:1.5b` (fast, currently selected)
- `gemma3:4b` (good balance)
- `gpt-oss:20b` (larger, better quality)
- `gpt-oss:120b` (huge, best quality)

### 2. Change Models

Edit [.env](/.env) and change `LLM_MODEL`:

```bash
# For faster responses (currently selected):
LLM_MODEL=deepseek-r1:1.5b

# For better quality:
LLM_MODEL=gemma3:4b

# For even better quality:
LLM_MODEL=gpt-oss:20b
```

### 3. Using OpenAI Instead

If you prefer OpenAI:

```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4
LLM_API_KEY=sk-your-key-here
# Comment out or remove LLM_BASE_URL
```

## Chat Commands

Once the agent starts, you'll see:

```
You: _
```

### Example Conversations

**Simple chat:**

```
You: Hello! Who are you?
```

**Using tools:**

```
You: Search for the latest news about Bitcoin
```

**File operations:**

```
You: Read the README.md file
```

**Screenshots:**

```
You: Take a screenshot of https://example.com
```

### Exit

Type `exit` or press Ctrl+C to quit.

## Troubleshooting

### "Cannot connect to Ollama"

1. **Check Ollama is running:**

    ```bash
    ollama list
    ```

2. **Check Ollama API:**

    ```bash
    curl http://localhost:11434/api/tags
    ```

3. **Start Ollama if needed:**
    ```bash
    ollama serve
    ```

### "Model not found"

Make sure the model in `.env` matches one from `ollama list`:

```bash
ollama list
```

Then update `.env` with the correct model name.

### "Port already in use"

If Ollama is running but on a different port, update `LLM_BASE_URL` in `.env`:

```bash
LLM_BASE_URL=http://localhost:YOUR_PORT/v1
```

## Development Mode (With Hot Reload)

For development with auto-restart on file changes:

```bash
pnpm dev
```

## Programmatic Usage

You can also use the agent in your own code:

```typescript
import { createAgent } from '@forkscout/agent';

const agent = await createAgent({
    llm: {
        provider: 'ollama',
        model: 'deepseek-r1:1.5b',
        baseURL: 'http://localhost:11434/v1',
    },
});

// Single message
const response = await agent.processMessage('Hello!');
console.log(response);

// Interactive mode
await agent.run();
```

## Docker Environment

If running inside Docker with host Ollama, change `.env`:

```bash
LLM_BASE_URL=http://host.docker.internal:11434/v1
```

## Need Help?

- Check [QUICKSTART.md](QUICKSTART.md) for setup details
- Read [PROJECT_STATUS.md](PROJECT_STATUS.md) for feature overview
- See [README.md](README.md) for API docs
