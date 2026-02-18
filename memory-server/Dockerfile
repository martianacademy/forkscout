FROM node:22-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests first (cache layer)
COPY package.json pnpm-lock.yaml* ./

# Install deps — production only
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN pnpm build

# Prune dev deps
RUN pnpm prune --prod

# ── Runtime ───────────────────────────────────
ENV NODE_ENV=production
ENV MEMORY_PORT=3211
ENV MEMORY_HOST=0.0.0.0
ENV MEMORY_STORAGE=/data

EXPOSE 3211

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost:3211/health || exit 1

CMD ["node", "dist/server.js"]
