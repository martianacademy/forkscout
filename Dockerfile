# ─── Forkscout Agent Docker Image ───
# Multi-stage build: install deps → install Playwright browsers → run
#
# Includes:
#   - Node.js 22 (LTS)
#   - pnpm
#   - Playwright Chromium (for web search/browse/screenshot tools)
#   - git (for watchdog rollback & self-edit tools)
#   - curl (for healthcheck)

# ── Stage 1: Install dependencies ──
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent/package.json ./packages/agent/package.json

# Install all deps (including devDependencies for tsx)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Final image ──
FROM node:22-slim

# System deps: git (watchdog/self-edit), curl (healthcheck), plus Playwright OS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    # Playwright Chromium dependencies
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/agent/node_modules ./packages/agent/node_modules

# Copy source code
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/agent ./packages/agent

# Install Playwright Chromium browser
RUN cd packages/agent && npx playwright install chromium

# Runtime data volume (persists memory, knowledge graph, sessions, etc.)
VOLUME /app/packages/agent/.forkscout

# Default port
EXPOSE 3210

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3210/api/status || exit 1

# Run the agent server
WORKDIR /app/packages/agent
CMD ["npx", "tsx", "src/serve.ts"]
