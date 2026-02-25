# ─── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app

# Copy lockfile + manifest first (better layer caching)
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM oven/bun:1 AS runner
WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# .forkscout/ is mounted as a volume at runtime (auth.json + chat history)
# Pre-create the directory so the mount point exists with correct ownership
RUN mkdir -p /app/.forkscout/chats && chown -R bun:bun /app/.forkscout

# Drop privileges
USER bun

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
