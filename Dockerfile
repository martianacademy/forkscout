# ─── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

# Copy lockfile + manifest first (better layer caching)
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM oven/bun:1 AS runner
WORKDIR /app

# Install Playwright's Chromium + all system dependencies for headless browser
# chromePath is left empty in Docker — bundled Chromium is used automatically
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget gnupg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Install Chromium and its OS-level deps via Playwright CLI
RUN bunx playwright install chromium --with-deps

# .forkscout/ is mounted as a volume at runtime (auth.json + chat history)
RUN mkdir -p /app/.forkscout/chats && chown -R bun:bun /app/.forkscout

# Drop privileges
USER bun

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
