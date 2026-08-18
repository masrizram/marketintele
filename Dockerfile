# ── MarketIntele Arbitrage Intelligence Engine — Dockerfile ──────────────────
# Multi-stage build: build TypeScript → slim runtime image
# Usage: docker build -t marketintele .

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Native module (better-sqlite3) build deps: Python + build-base for node-gyp
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy lockfile + package.json first for layer caching
COPY package*.json ./

# Install ALL deps (including devDeps for build)
RUN npm ci

# Copy source
COPY tsconfig.json tsconfig.test.json ./
COPY src/ ./src/

# Build TypeScript → dist/
RUN npx tsc --noEmit && npm run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Native module (better-sqlite3) rebuild needs the same build deps at install.
# Chromium for Lazada browser-rendered adapter (Phase 25). The browser adapter
# uses CDP to render Lazada's JS-rendered SPA search page and extract product
# data. Chromium runs with --no-sandbox (the Fly container itself provides
# isolation; Chromium is not exposed externally and only navigates to
# allowlisted Lazada domains). CDP is bound to localhost only.
RUN apk add --no-cache python3 make g++ chromium nss freetype harfbuzz ca-certificates ttf-freefont

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && apk del python3 make g++

ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy built artifacts
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/data

# Health check: verify the health server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9090/health || exit 1

# Expose health/metrics port
EXPOSE 9090

# Non-root user for security
RUN addgroup -S marketintele && adduser -S marketintele -G marketintele
RUN chown -R marketintele:marketintele /app
USER marketintele

CMD ["node", "dist/index.js"]
