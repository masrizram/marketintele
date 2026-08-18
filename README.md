# AI Product Sourcing & Marketplace Arbitrage Intelligence Engine

**Version:** 2.0.1  
**Target Market:** Indonesia  
**Production Gate:** `INFRASTRUCTURE_READY`  
**Audit Baseline:** `FINAL_PRODUCTION_AUDIT_V3.md` (2026-08-15)  
**Platform:** Fly.io + Supabase

A TypeScript arbitrage intelligence engine that discovers products on Indonesian marketplaces (Shopee, Tokopedia, Lazada, Blibli, TikTok Shop) via web scraping, sources them from B2B suppliers, and computes risk-adjusted profit opportunities through a fail-closed, financially-integrity-first pipeline.

> **Read this first.** This README documents the system **as it actually exists today** and distinguishes **IMPLEMENTED** from **TESTED** from **RUNTIME_VERIFIED** from **PRODUCTION_READY**. The current gate is `INFRASTRUCTURE_READY` — marketplace scraping is deployed and verified; real supplier adapter remains `NOT_TESTED`. See [§2 Current Status](#2-current-project-status) and [§24 Production Readiness](#24-production-readiness).

---

## Architecture at a Glance

The system has two deployment surfaces that share one business-logic core:

```
┌───────────────────────── FLY.IO (persistent worker) ───────────────────────┐
│  HEALTH SERVER (port 9090):                                                │
│  GET /live, /ready, /health, /metrics (with Bearer auth)                   │
│  TELEGRAM BOT: long polling via Telegraf                                   │
│  SCRAPING ENGINE: browser (CDP) + HTTP scrapers                            │
│  Shared engine → src/arbitrage/** → DB layer                               │
│  PERSISTENT PROCESS — runs continuously, 1 instance                        │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ TLS (pooled PG, port 6543)
                                   ▼
┌──────────────────────── SUPABASE (PostgreSQL 16) ──────────────────────────┐
│  28 tables + schema_migrations, 27 FKs, 98 indexes, NUMERIC(18,4)          │
│  PgBouncer (port 6543) for serverless; direct (5432) for worker/DDL.       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Platform:** Deployed on Fly.io (region: `sin`) as a persistent worker process.  
**Database:** Supabase PostgreSQL (`ap-northeast-1`).  
**No Vercel:** This is a long-running worker with Telegram long polling, browser automation, and scraping — incompatible with serverless functions.

---

## Quick Start (Fly.io + Supabase)

The shortest verified path from a fresh clone to a running system.

```bash
# 1. Prerequisites: Node.js >= 20, npm, a Supabase project (or local PostgreSQL)
node --version   # must be >= 20

# 2. Clone & install
git clone <repo-url> marketintele
cd marketintele
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local: set SUPABASE_DATABASE_URL, TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, ADMIN_API_KEY

# 4. Apply database migration to Supabase
npm run migrate

# 5. Verify the database connection end-to-end
npm run verify:supabase

# 6. Typecheck, build, test
npx tsc --noEmit
npm run build
npm test

# 7. Deploy to Fly.io
flyctl deploy

# 8. Verify health (with Bearer auth)
flyctl ssh console
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:9090/health
```

> **Local PostgreSQL fallback:** If you prefer not to use Supabase, set `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` instead and run `docker compose up -d postgres`. The DB layer resolves `SUPABASE_DATABASE_URL → DATABASE_URL → PG_*` in that order. See [§12 Local Development](#12-local-development).

> **TEST_FIXTURE ≠ production data.** Fixture results prove the pipeline mechanics work; they do **not** prove real-world arbitrage profitability. See [§20 TEST_FIXTURE Mode](#20-test_fixture-mode).

---

## 1. Overview

MarketIntele is an arbitrage intelligence engine that answers:

> *"Can I buy product X from a B2B supplier at cost C, sell it on marketplace M at the market clearing price P, and realize a risk-adjusted profit after landed cost, fees, returns, and competition?"*

The system enforces a strict **fail-closed** philosophy: when a mandatory economic input is `UNKNOWN`, it stays `UNKNOWN` — never silently coerced to `0`. A missing supplier cost never produces a positive opportunity.

### The arbitrage distinction

| Entity | Meaning | Source |
|---|---|---|
| **MARKET_PRICE** | Retail listing price on a marketplace | Marketplace scraper (Shopee, Tokopedia, …) |
| **SUPPLIER_PRICE** | B2B wholesale/quotation cost | Supplier adapter (manufacturer, distributor, …) |

**Marketplace selling price ≠ supplier cost.** A marketplace listing is never treated as a supplier quotation.

### Pipeline at a glance

```
Discovery → Market Clearing Price → Matching → Supplier Sourcing
→ Landed Cost → Marketplace Cost → Profit (dual-engine) → Demand
→ Competition → Risk (11 dims) → Decay → Expected Value
→ 15 Decision Gates (C01–C15) → RECOMMEND / REVIEW / REJECT
```

---

## 2. Current Project Status

| Area | Status | Evidence |
|---|---|---|
| Build | **PASS** | `npm run build` → exit 0 |
| Typecheck | **PASS** | `npx tsc --noEmit` → exit 0 |
| Tests | **PASS** | `npm test` → 545/545 pass, 34 suites |
| Coverage | **PASS** | 85.62% statements (threshold 80% met) |
| Lint | **PASS** | `npx eslint src --ext .ts --quiet` → 0 errors |
| Financial Integrity | **PASS** | UNKNOWN≠0, Decimal precision 28, dual-engine, NaN rejected |
| Supabase DB layer | **DEPLOYED + VERIFIED** | Connection resolver, migration, verify command; live Supabase (16/16 PASS) |
| Fly.io Deployment | **DEPLOYED** | Persistent worker on Fly.io `sin` region |
| Marketplace Scraping | **DEPLOYED + VERIFIED** | 5 adapters (3 HTTP + 2 CDP), anti-blocking, runtime verified |
| Anti-Blocking Strategy | **IMPLEMENTED** | User-agent rotation, delays, retries, circuit breaker |
| Browser Automation | **DEPLOYED + VERIFIED** | Chromium running in Fly.io container |
| Supplier Sourcing | **INTEGRATION_VERIFIED** | Contract complete, 21 failure-injection tests; real runtime **NOT_TESTED** |
| PostgreSQL | **RUNTIME_VERIFIED** | 28 integration tests against PostgreSQL 16 (when DB available) |
| Security | **PASS** | 64 SSRF/security tests + Bearer auth for endpoints |
| Observability | **DEPLOYED** | /live, /ready, /health, /metrics + 12 metrics, 17 tests |
| Fly.io Health Checks | **DEPLOYED** | /live (15s), /ready (30s) with Bearer auth |
| Production Gate | **INFRASTRUCTURE_READY** | P0=0, P1=1 (real supplier adapter needed) — marketplace scraping is DEPLOYED |

---

## 3. Deployment Surfaces

### 3.1 Fly.io Worker (Persistent)

The application runs as a **persistent worker** on Fly.io:

**Deployment Configuration:**
- **Platform**: Fly.io Machines
- **Region**: `sin` (Singapore) — co-located with Supabase Tokyo
- **Instance**: `shared-cpu-1x` (1GB RAM)
- **Storage**: Persistent volume `/app/data` for SQLite
- **Port**: 9090 (internal)
- **Health Checks**: `/live` (15s), `/ready` (30s)

**Endpoints (with Bearer Auth):**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/health` | GET | Bearer token | Aggregate health status |
| `/live` | GET | Bearer token | Liveness probe |
| `/ready` | GET | Bearer token | Readiness (PG + adapters) |
| `/metrics` | GET | Bearer token | Prometheus metrics |

**Why Fly.io?**
- Persistent process required for Telegram long polling
- Browser automation (CDP) needs stable runtime
- Scraping jobs require state management
- Better cost efficiency for continuous workloads

The worker runs `src/index.ts`:
- Telegram `bot.launch()` long polling.
- Health/metrics server on `:9090` (Bearer-protected).
- Legacy SQLite (user preferences/promo history).
- Marketplace scrapers (CDP + HTTP) invoked by the `/arbitrage` command.
- Arbitrage pipeline.

Deployed via `flyctl deploy`. The worker guard (`requireWorkerConfig`) fails fast if `TELEGRAM_BOT_TOKEN` is missing.

### 3.2 Supabase (Database)

Supabase PostgreSQL 16 hosts all persistent data. The existing migration (`0001-core-foundation.sql`) runs unchanged — it uses only standard PostgreSQL features (tables, FKs, indexes, ENUMs, `NUMERIC(18,4)`, `JSONB`, `TIMESTAMPTZ`, `ON CONFLICT`). No Supabase SDK is introduced; the app uses `pg` (node-postgres) for all access.

---

## 4. Technology Stack

| Category | Technology | Version |
|---|---|---|
| Runtime | Node.js | >= 20.0.0 (verified v22) |
| Language | TypeScript | ^5.3.3 (strict) |
| Database (cloud) | Supabase PostgreSQL | 16 |
| Database (local) | PostgreSQL via Docker | 16-alpine |
| Database driver | `pg` (node-postgres) | ^8.11.3 |
| Validation | Zod | ^3.22.4 |
| Numerical | decimal.js (precision 28) | ^10.4.3 |
| Logging | pino (structured JSON) | ^8.17.0 |
| Bot framework | Telegraf (worker only) | ^4.16.3 |
| HTTP client | axios + axios-retry | ^1.6.7 / ^3.9.0 |
| Browser automation | Puppeteer/Chromium (CDP) | ^22 |
| HTML parsing | cheerio | ^1.0.0-rc.12 |
| IDs | ulid | ^2.3.0 |
| Hosting | Fly.io (persistent worker) | — |
| Testing | Jest + ts-jest | ^30 / ^29 |
| Linting | ESLint + @typescript-eslint | ^8 / ^6 |

---

## 5. Repository Structure

```
marketintele/
├── src/
│   ├── index.ts                # Worker entrypoint (Telegram + Health server)
│   ├── config.ts               # Zod env validation + requireWorkerConfig
│   └── arbitrage/
│       ├── adapters/           # Marketplace scrapers (HTTP + CDP/Chromium)
│       │   ├── shopee-adapter.ts
│       │   ├── tokopedia-browser-adapter.ts
│       │   ├── lazada-browser-adapter.ts
│       │   ├── blibli-adapter.ts
│       │   └── tiktokshop-adapter.ts
│       ├── db/
│       │   ├── connection.ts   # Supabase/URI/PG_* resolver
│       │   ├── pool.ts         # Shared pool
│       │   ├── migrate.ts      # Migration runner (Supabase-aware)
│       │   ├── verify-supabase.ts  # Runtime verification CLI
│       │   ├── migrations/0001-core-foundation.sql
│       │   └── *.test.ts
│       ├── economic/           # Financial engines (Decimal, landed cost, fees, profit)
│       ├── intelligence/       # Market-clearing, demand, competition, risk, EV, decay, lifecycle, learning
│       ├── observability/      # Health + Prometheus metrics
│       ├── pipeline/           # Orchestrator + decision gates
│       ├── reliability/        # Circuit breaker
│       ├── sourcing/           # Supplier adapter contract + fixture + harness
│       └── lib/                # Logger, hash, ulid, utils
├── fly.toml                    # Fly.io deployment configuration
├── Dockerfile                  # Multi-stage Docker build (incl. Chromium)
├── .dockerignore               # Docker ignore patterns
├── docker-compose.yml          # Local PostgreSQL + worker
├── .github/workflows/ci.yml   # CI pipeline
├── package.json                # Node dependencies
├── tsconfig.json               # TypeScript config
└── README.md                   # This documentation
```

**Note:** No `api/` directory. No `vercel.json`. All endpoints served from `src/index.ts` health server on the Fly.io worker.

---

## 6. Supabase Setup

### 6.1 Create a Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project.
2. Set a strong database password.
3. Wait for provisioning to complete.

### 6.2 Get the connection string

- Dashboard → Project → Settings → Database → **Connection string** → **URI**.
- For the **worker**: use the **pooled** connection (port **6543**). Append `?sslmode=require`.
- For **migrations**: use the **direct** connection (port **5432**) for DDL reliability. Append `?sslmode=require`.

Example pooled URI:
```
postgresql://postgres.xxxx:YOUR_PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
```

### 6.3 Configure environment

```bash
cp .env.example .env.local
# Edit .env.local:
#   SUPABASE_DATABASE_URL=postgresql://postgres.xxxx:...@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require
#   TELEGRAM_BOT_TOKEN=<from @BotFather>
#   ALLOWED_USER_IDS=<your Telegram user ID>
#   ADMIN_API_KEY=<strong random value for health endpoints>
```

### 6.4 Apply migration

```bash
npm run migrate
```

The migration is idempotent, transactional, and records a SHA-256 checksum per file in `schema_migrations`. On Supabase, prefer the direct connection (port 5432) for DDL.

### 6.5 Verify the connection

```bash
npm run verify:supabase
```

This runs 16 checks (connectivity, TLS, auth, SELECT/INSERT/UPDATE/DELETE, transaction commit/rollback, FK/unique enforcement, concurrent access, reconnect, persistence, migration state, schema version) against a scratch table that is created and dropped per run — never touching production data. Exit 0 on full PASS.

---

## 7. Environment Variables

Copy `.env.example` → `.env.local` and fill in real values. **Never commit `.env*`.**

### Database (resolution order: first non-empty wins)

| Variable | Required? | Purpose |
|---|---|---|
| `SUPABASE_DATABASE_URL` | preferred prod | Supabase PostgreSQL pooled/direct URI |
| `DATABASE_URL` | optional | Any standard PostgreSQL URI |
| `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` / `PG_SSL_MODE` | local fallback | Discrete vars for local Docker/PostgreSQL |
| `PG_POOL_MAX` | optional | Max pool connections (worker: 10) |

### Application

| Variable | Required? | Purpose |
|---|---|---|
| `APPLICATION_ENV` | optional | `development` / `test` / `production` |
| `WORKER_MODE` | worker only | Must be `true` on Fly.io |
| `ADMIN_API_KEY` | ✅ Yes | Strong random value; Bearer token for health endpoints |

### Telegram (worker only)

| Variable | Required? | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | worker ✅ | Bot token from @BotFather |
| `ALLOWED_USER_IDS` | recommended | Comma-separated authorized Telegram user IDs |

### Scraping Configuration

| Variable | Default | Purpose |
|---|---|---|
| `SCRAPER_REQUEST_TIMEOUT_MS` | 30000 | Request timeout |
| `SCRAPER_DELAY_MIN_MS` | 1000 | Minimum delay between requests |
| `SCRAPER_DELAY_MAX_MS` | 5000 | Maximum delay between requests |
| `MAX_CONCURRENT_REQUESTS` | 5 | Max concurrent scraping requests |
| `SSRF_FIREWALL_ENABLED` | `true` | SSRF protection (do not disable in prod) |
| `SCRAPER_PROXY_URL` | — | Optional proxy URL |

### Operational (preserved)

| Variable | Default | Purpose |
|---|---|---|
| `HEALTH_PORT` | `9090` | Worker health server port |
| `PG_SKIP_OK` | `true` | Skip (not pass) PG tests when DB unavailable |
| `LOG_LEVEL` | `info` | trace/debug/info/warn/error/fatal |
| `MAX_SEARCH_RESULTS` | 10 | Max search results per query |
| `NOTIFICATION_CHECK_INTERVAL_SEC` | 300 | Bot notification interval |
| `REDIS_URL` | redis://localhost:6379/0 | Parsed; not used at runtime |
| `DATABASE_PATH` | ./data/belibot.db | Legacy SQLite (worker only) |

---

## 8. Database Migration

```bash
npm run migrate
```

- Runs `src/arbitrage/db/migrate.ts` via `tsx`.
- Idempotent: already-applied migrations are skipped.
- Transactional per file (`BEGIN`/`COMMIT`; `ROLLBACK` on error).
- Records SHA-256 checksums in `schema_migrations`.
- Exit 0 on success, exit 1 on failure.
- Connection resolution: `SUPABASE_DATABASE_URL → DATABASE_URL → PG_*`.

**Rollback:** Forward-only (no down-migrations). Back up with `pg_dump` before applying to production.

---

## 9. Runtime Verification

```bash
npm run verify:supabase
```

16 checks against the resolved DB, using a scratch table. Safe to run against any environment. Exit 0 on PASS, 1 on FAIL, 0 on SKIP (when `PG_SKIP_OK=true` and DB unreachable).

---

## 10. Running Tests

```bash
npm test
npm run test:watch
npm run test:coverage       # 85.62% statements
```

Targeted:
```bash
npx jest src/arbitrage/db/connection.test.ts   # connection resolver
npx jest src/arbitrage/db/pg-integration.test   # PostgreSQL (needs DB)
npx jest src/arbitrage/pipeline/pipeline-scenarios.test.ts
```

> PostgreSQL integration tests require a running DB matching your `.env`. Without it, they skip (not pass) when `PG_SKIP_OK=true`. CI sets `PG_SKIP_OK=false` so they fail if the DB is down.

---

## 11. Typecheck / Build / Lint

```bash
npx tsc --noEmit             # typecheck
npm run build                # build → dist/
npx eslint src --ext .ts --quiet
```

---

## 12. Local Development

### Option A — Supabase cloud (preferred)

1. Create a Supabase project (§6).
2. `cp .env.example .env.local`; set `SUPABASE_DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`, `ADMIN_API_KEY`.
3. `npm run migrate`.
4. `npm run verify:supabase`.
5. `npm test`.
6. `npm run dev`.

### Option B — Local PostgreSQL/Docker (fallback)

```bash
docker compose up -d postgres   # PG 16 on :5433
# .env: set PG_HOST=localhost PG_PORT=5433 PG_USER=... PG_PASSWORD=... PG_DATABASE=...
npm run migrate
npm test
npm run dev
```

Both paths use the **same** `connection.ts` resolver.

---

## 13. Starting the Application (Worker)

```bash
WORKER_MODE=true npm start     # node dist/index.js (production)
npm run dev                   # tsx watch (development)
```

Startup sequence: Zod config → `requireWorkerConfig()` (throws if no Telegram token) → SQLite init → PostgreSQL health check → fee validation → adapter registration → health server `:9090` → Telegram `bot.launch()`.

- SQLite is **required** (user prefs). Failure exits 1.
- PostgreSQL is **health-checked**, not required to boot — degraded mode if unreachable.
- Graceful shutdown: `SIGINT`/`SIGTERM` → stop health server → close PG pool → stop bot → `adapterRegistry.shutdownAll()` → exit 0.

---

## 14. Health Checks (Worker)

| Endpoint | Success | Failure |
|---|---|---|
| `GET /live` | 200 `{status:"alive",uptime,timestamp}` | — |
| `GET /ready` | 200 `{status:"ready",dependencies}` | 503 `{status:"not_ready",...}` |
| `GET /health` | 200 `{status,checks,uptime,version}` | — |
| `GET /metrics` | 200 Prometheus text | — |

All endpoints require Bearer auth (`Authorization: Bearer <ADMIN_API_KEY>`).

---

## 15. Metrics & Observability

12 Prometheus metrics (see [§21](#21-metrics--observability)). Distinguish pipeline requests, DB failures, adapter failures, opportunity generation/rejection, circuit breaker state. Secrets are never exposed (verified by tests).

---

## 16. Fly.io Deployment

### 16.1 Install flyctl
```bash
# Windows
iwr https://fly.io/install.ps1 -useb | iex

# macOS/Linux
curl -L https://fly.io/install.sh | sh
```

### 16.2 Login
```bash
flyctl auth login
```

### 16.3 Configure Environment Secrets
```bash
flyctl secrets set \
  TELEGRAM_BOT_TOKEN="<your-token>" \
  SUPABASE_DATABASE_URL="postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require" \
  ADMIN_API_KEY="<strong-random-key>" \
  ALLOWED_USER_IDS="<your-user-id>" \
  LOG_LEVEL="info" \
  SSRF_FIREWALL_ENABLED="true"
```

> `WORKER_MODE`, `HEALTH_PORT`, and `SSRF_FIREWALL_ENABLED` are already set in `fly.toml` `[env]` block.

### 16.4 Deploy
```bash
flyctl deploy
```

### 16.5 Verify
```bash
# Check status
flyctl status

# Check health
flyctl checks list

# Test health endpoint (with auth)
flyctl ssh console
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:9090/health

# View logs
flyctl logs --tail
```

### 16.6 Scale
```bash
# Scale up (more memory/CPU)
flyctl scale vm shared-cpu-2x

# Scale down
flyctl scale vm shared-cpu-1x
```

### 16.7 Rollback
```bash
# List releases
flyctl releases list

# Rollback to previous
flyctl rollback --previous
```

### 16.8 Troubleshooting
```bash
# SSH into container
flyctl ssh console

# Check logs
flyctl logs -n 100

# Restart
flyctl restart
```

---

## 17. Worker Deployment (Docker)

```bash
docker build -t marketintele-worker .
docker run -d --env-file .env -p 9090:9090 marketintele-worker
```

Or with `docker-compose.yml`:
```bash
docker compose up -d
```

The Dockerfile is multi-stage, runs as a non-root user, includes a health check, and exposes 9090. For production, set `WORKER_MODE=true`, `TELEGRAM_BOT_TOKEN`, `SUPABASE_DATABASE_URL` (pooled, port 6543), `ALLOWED_USER_IDS`, and `ADMIN_API_KEY` in the container env.

---

## 18. CI/CD

`.github/workflows/ci.yml` runs on push/PR:
1. `npm ci`
2. Start PostgreSQL 16 service container
3. `npm run migrate`
4. `npm run verify:supabase` (with `DATABASE_URL` pointing at the service container)
5. `npx tsc --noEmit`
6. `npx eslint src --ext .ts --quiet`
7. `npm run build`
8. `npx jest --coverage`
9. Secret scan + dependency audit (separate job)

CI sets `PG_SKIP_OK=false` so DB tests **fail** (not silently pass) if PostgreSQL is unreachable.

---

## 19. Security

- `.env` / `.env.local` gitignored; `.env.example` uses placeholders only.
- Zod validates config; worker guard fails fast without Telegram token.
- SSRF firewall on by default (IPv4/IPv6, DNS resolution, redirect re-validation).
- Telegram authorization (`ALLOWED_USER_IDS`) preserved in worker.
- Health endpoints gated by Bearer auth (`ADMIN_API_KEY`).
- Logs redact secrets (`password`, `token`, `secret`, `PG_PASSWORD`, `TELEGRAM_BOT_TOKEN`).
- RLS **not enabled** (no browser→Supabase path today). If a dashboard with direct browser DB access is added, RLS must be turned on.

---

## 20. TEST_FIXTURE Mode

`TestFixtureSupplierAdapter` returns deterministic, explicitly-labelled fixture offers so the full pipeline produces a complete vertical slice during development. Every offer is stamped `dataProvenance: 'TEST_FIXTURE'` with `TEST_FIXTURE — NOT REAL DATA` evidence. **Fixture profit ≠ realized profit.**

---

## 21. Metrics & Observability

| Metric | Type | Labels |
|---|---|---|
| `pipeline_runs_total` | counter | — |
| `pipeline_success_total` / `pipeline_failure_total` | counter | — |
| `pipeline_duration_seconds` | histogram | — |
| `adapter_requests_total` / `adapter_failures_total` | labeled counter | adapter, status / error_type |
| `supplier_resolution_total` | counter | — |
| `opportunities_discovered_total` / `opportunities_rejected_total` / `opportunities_verified_total` | counter | — |
| `database_errors_total` | counter | — |
| `circuit_breaker_trips_total` | counter | — |

---

## 22. Marketplace Scraping Strategy

MarketIntele uses **web scraping** (not official APIs) for marketplace data extraction.

### Why Scraping Instead of API?

1. **No API Access**: No official API access for small-scale partners
2. **Real-time Data**: Data directly from product pages (real-time)
3. **Flexibility**: Can extract additional data (reviews, ratings, stock)
4. **Cost**: No API fees (only infrastructure costs)

### Scraping Methods

| Marketplace | Method | Tool | Status |
|-------------|--------|------|--------|
| **Shopee** | HTTP | axios + cheerio | ✅ PRODUCTION |
| **Tokopedia** | Browser (CDP) | Puppeteer/Chromium | ✅ PRODUCTION |
| **Lazada** | Browser (CDP) | Puppeteer/Chromium | ✅ PRODUCTION |
| **Blibli** | HTTP | axios + cheerio | 🔬 BETA |
| **TikTok Shop** | HTTP | axios + cheerio | 🔬 BETA |

### Anti-Blocking Strategies

1. **User-Agent Rotation**
   ```typescript
   const userAgents = [
     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...',
     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...',
     // 10+ variants
   ];
   ```

2. **Request Delays**
   ```typescript
   const delay = Math.floor(Math.random() * 4000) + 1000; // 1-5s
   await sleep(delay);
   ```

3. **Retry with Exponential Backoff**
   ```typescript
   const retries = 3;
   const backoff = (attempt) => Math.pow(2, attempt) * 1000;
   ```

4. **Browser Fingerprinting**
   ```typescript
   await page.setViewport({ width: 1920, height: 1080 });
   await page.setExtraHTTPHeaders({ 'Accept-Language': 'id-ID,id;q=0.9' });
   ```

5. **Circuit Breaker**
   ```typescript
   if (failures > 5 in 1 minute) {
     circuitBreaker.open(); // Cool down 5 minutes
   }
   ```

6. **Proxy Support (Optional)**
   ```env
   SCRAPER_PROXY_URL=http://proxy:8080
   ```

### Browser Automation (CDP)

For JS-heavy marketplaces (Tokopedia, Lazada):

```typescript
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu'
  ]
});

const page = await browser.newPage();
await page.setUserAgent(randomUserAgent());
await page.goto(url, { waitUntil: 'networkidle2' });
const products = await page.evaluate(() => {
  // DOM extraction
});
```

### HTTP Scraping

For simpler marketplaces (Shopee, Blibli, TikTok Shop):

```typescript
const response = await axios.get(url, {
  headers: {
    'User-Agent': randomUserAgent(),
    'Accept': 'application/json',
    'Referer': 'https://shopee.co.id/'
  },
  timeout: 30000
});

const products = parseHTML(response.data);
```

### Error Handling

| Error Type | Handling |
|------------|----------|
| **Network Error** | Retry (3x) with backoff |
| **HTTP Error (4xx/5xx)** | Circuit breaker triggers |
| **Parse Error** | Log, skip, continue |
| **Timeout** | Retry with longer timeout |
| **CAPTCHA** | Alert + manual resolution |

---

## 23. Financial Integrity Model

| Invariant | How enforced |
|---|---|
| `UNKNOWN ≠ ZERO` | null cost components throw; never coerced to 0 |
| `MARKETPLACE_PRICE ≠ SUPPLIER_PRICE` | marketplace sellers return `sourcePriceIdr = null` |
| No floats in financial path | `decimal.js` precision 28, `ROUND_HALF_EVEN` |
| NaN/Infinity rejected | `D()` throws `ParseError` |
| Independent dual-engine | Engine B re-sums raw components |
| Σ probabilities = 1 | EV rejects non-normalized scenarios |
| Every cost has provenance | `source`, `confidence`, `effectiveFrom`, `version` |
| Stale data blocks decision | C13 fails on missing `observedAt` |
| Negative profit ≠ opportunity | C09 requires `netProfit > 0` AND `reconciled = true` |

Decision gates C01–C15 (13 critical + 2 warning). Any critical fail → `REJECT` (fail-closed).

---

## 24. Known Limitations

| Area | Classification | Detail |
|---|---|---|
| Real supplier adapter | NOT_TESTED | No B2B API credentials or supplier scraping |
| Marketplace scraping | **DEPLOYED + VERIFIED** | 5 adapters, anti-blocking, runtime verified |
| CAPTCHA handling | MANUAL | Detection implemented, requires manual resolution |
| HTML structure change | WARNING | No automated detection, needs monitoring |
| Circuit breaker wiring | NOT_WIRED | Implemented + tested, not yet production-wired |
| Model calibration | NOT_TESTED | No historical realized-profit data |
| Dead-letter queue | MISSING | No async queue |
| Migration rollback | NOT_IMPLEMENTED | Forward-only |

---

## 25. Production Readiness

- [x] build, typecheck, lint, tests, coverage
- [x] financial integrity (UNKNOWN≠0, dual-engine, C01–C15)
- [x] PostgreSQL runtime (28 integration tests)
- [x] health/metrics, graceful shutdown
- [x] Supabase DB layer implemented + tested (connection resolver, verify command)
- [x] Fly.io deployment + health checks (/live, /ready)
- [x] Bearer auth for health endpoints
- [x] Marketplace scraping deployed + verified (5 adapters, anti-blocking)
- [x] Browser automation (Chromium in Fly.io container)
- [x] Prometheus metrics (12 metrics)
- [ ] real supplier API/scraping (NOT_TESTED)
- [ ] CAPTCHA auto-resolution (MANUAL)
- [ ] 7-day production observation (PLANNED)
- [ ] model calibration (NOT_TESTED)

**Production Gate: `INFRASTRUCTURE_READY`** — Infrastructure, marketplace scraping, database, and security are deployed and verified. P1 business-verification item remains: real supplier adapter. Score: **7.5/10** (Infrastructure: 9/10, Security: 8/10, Data: 5/10, Scraping: 8/10).

---

## 26. Rollback

- **Code:** `git checkout <previous-tag>` → rebuild → redeploy.
- **DB:** forward-only; restore from pre-migration `pg_dump` backup.
- **Fly.io:** `flyctl rollback --previous` to revert to the previous release.
- **Worker:** redeploy previous Docker image.

---

## 27. Troubleshooting

| Symptom | Fix |
|---|---|
| `DbConfigError: No database configuration found` | Set `SUPABASE_DATABASE_URL` or `PG_*` |
| Migration `ECONNREFUSED` | Start PostgreSQL (`docker compose up -d postgres`) or verify Supabase URI |
| `/ready` returns 503 | PostgreSQL or adapters not ready |
| `/health` returns 401 | Missing/wrong `Authorization: Bearer <token>` header |
| Telegram `401 Unauthorized` | Invalid `TELEGRAM_BOT_TOKEN`; regenerate via @BotFather |
| `⛔ Akses ditolak` | User not in `ALLOWED_USER_IDS` |
| Browser crashes on Fly.io | Chromium out of memory; scale to `shared-cpu-2x` |

---

## 28. License

**Not yet specified.** No `LICENSE` file present. All rights reserved until a license is added.

---

## 29. Disclaimer

This system provides sourcing and arbitrage intelligence. It does **not** guarantee profit. Fixture data is not production evidence. Any decision made using this system's output is the sole responsibility of the operator.