# ── MarketIntele Arbitrage Intelligence Engine — Dockerfile ──────────────────
# Multi-stage build: build TypeScript → slim runtime image
# Usage: docker build -t marketintele .

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

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

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

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
