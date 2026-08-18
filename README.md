# MarketIntele — AI Product Sourcing & Marketplace Arbitrage Intelligence Engine

**Version:** 2.0.0  
**Target Market:** Indonesia  
**Platform:** Fly.io + Supabase  
**License:** MIT  

A TypeScript arbitrage intelligence engine that discovers products on Indonesian marketplaces (Shopee, Tokopedia, Lazada, Blibli, TikTok Shop) via web scraping, sources them from B2B suppliers, and computes risk-adjusted profit opportunities through a fail-closed, financially-integrity-first pipeline.

> This README documents the system as it actually exists. It distinguishes **IMPLEMENTED** from **TESTED** from **RUNTIME_VERIFIED** from **PRODUCTION_READY**. The current production gate is `INFRASTRUCTURE_READY` — marketplace scraping is deployed and verified; real supplier adapter remains `NOT_TESTED`.

---

## Architecture at a Glance

```mermaid
flowchart TD
    subgraph Fly["Fly.io (persistent worker)"]
        Health["Health Server :9090\n/live /ready /health /metrics"]
        Bot["Telegram Bot (Telegraf long polling)"]
        Scraping["Scraping Engine\n5 adapters (3 HTTP + 2 CDP)"]
        Pipeline["Arbitrage Pipeline\nsrc/arbitrage/"]
        SQLite["Legacy SQLite\n(user prefs, history)"]
    end

    subgraph Supabase["Supabase (PostgreSQL 16)"]
        PG["28 tables, 27 FKs, 98 indexes\nNUMERIC(18,4) financial columns"]
    end

    User["Telegram User"] --> Bot
    Bot --> Pipeline
    Pipeline --> Scraping
    Pipeline --> PG
    Pipeline --> Health
    Scraping -->|"Shopee, Tokopedia, Lazada, Blibli, TikTok Shop"| MP["Indonesian Marketplaces"]
```

**Platform:** Deployed on Fly.io (region: `sin`) as a persistent worker process.  
**Database:** Supabase PostgreSQL 16 (`ap-northeast-1`).  
**No serverless:** This is a long-running worker with Telegram long polling, browser automation, and scraping — incompatible with serverless functions.

---

## Quick Start

```bash
# Prerequisites: Node.js >= 20, a Supabase project (or local PostgreSQL)
node --version   # must be >= 20

# Clone & install
git clone <repo-url> marketintele
cd marketintele
npm install

# Configure environment
# Create a .env file with the required variables (see Environment Variables below)

# Apply database migration
npm run migrate

# Verify database connection
npm run verify:supabase

# Typecheck, build, test
npx tsc --noEmit
npm run build
npm test

# Start development server
npm run dev
```

> **Local PostgreSQL fallback:** Set `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` and run `docker compose up -d postgres`. The DB layer resolves `SUPABASE_DATABASE_URL → DATABASE_URL → PG_*` in that order.

> **TEST_FIXTURE ≠ production data.** Fixture results prove pipeline mechanics work; they do not prove real-world arbitrage profitability.

---

## 1. Overview

MarketIntele answers:

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
→ 16 Decision Gates (C01–C15 + C13b) → RECOMMEND / REVIEW / REJECT
```

---

## 2. Current Project Status

| Area | Status | Evidence |
|---|---|---|
| Build | **PASS** | `npm run build` → exit 0 |
| Typecheck | **PASS** | `npx tsc --noEmit` → exit 0 |
| Tests | **PASS** | 40 suites, 696 unit tests passing (40 PG-dependent tests skip without DB) |
| Coverage | **PASS** | 85.62% statements (threshold 80% met) |
| Lint | **PASS** | `npx eslint src --ext .ts --quiet` → 0 errors |
| Financial Integrity | **PASS** | UNKNOWN≠0, Decimal precision 28, dual-engine, NaN rejected |
| Supabase DB layer | **DEPLOYED + VERIFIED** | Connection resolver, migration, verify command; 16/16 E2E checks |
| Fly.io Deployment | **DEPLOYED** | Persistent worker on Fly.io `sin` region |
| Marketplace Scraping | **DEPLOYED + VERIFIED** | 5 adapters (3 HTTP + 2 CDP), anti-blocking, runtime verified |
| Anti-Blocking Strategy | **IMPLEMENTED** | User-agent rotation, delays, retries, circuit breaker |
| Browser Automation | **DEPLOYED + VERIFIED** | Chromium running in Fly.io container |
| Supplier Sourcing | **INTEGRATION_VERIFIED** | Contract complete, 21 failure-injection tests; real runtime **NOT_TESTED** |
| PostgreSQL | **RUNTIME_VERIFIED** | 28 integration tests against PostgreSQL 16 (when DB available) |
| Security | **PASS** | SSRF firewall, Bearer auth for `/health` and `/metrics` |
| Observability | **DEPLOYED** | `/live`, `/ready`, `/health`, `/metrics` + 15 Prometheus metrics |
| Circuit Breaker | **WIRED** | Per-adapter breakers wired at bootstrap |
| Production Gate | **INFRASTRUCTURE_READY** | P0=0, P1=1 (real supplier adapter needed) |

---

## 3. Deployment Surfaces

### 3.1 Fly.io Worker (Persistent)

The application runs as a persistent worker on Fly.io:

- **Platform**: Fly.io Machines
- **Region**: `sin` (Singapore)
- **Instance**: `shared-cpu-1x` (1GB RAM)
- **Storage**: Persistent volume `/app/data` for SQLite
- **Port**: 9090 (internal)
- **Health Checks**: `/live` (15s), `/ready` (30s)

**Endpoints:**

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/live` | GET | None | Liveness probe |
| `/ready` | GET | None | Readiness (PG + adapters) |
| `/health` | GET | Bearer token | Aggregate health status |
| `/metrics` | GET | Bearer token | Prometheus metrics |

The worker runs `src/index.ts`:
- Telegram `bot.launch()` long polling.
- Health/metrics server on `:9090`.
- Legacy SQLite (user preferences/promo history).
- Marketplace scrapers (CDP + HTTP) invoked by the `/arbitrage` command.
- Arbitrage pipeline.

### 3.2 Supabase (Database)

Supabase PostgreSQL 16 hosts all persistent data. The migration (`0001-core-foundation.sql`) uses standard PostgreSQL features (tables, FKs, indexes, ENUMs, `NUMERIC(18,4)`, `JSONB`, `TIMESTAMPTZ`). The app uses `pg` (node-postgres) for all access — no Supabase SDK.

---

## 4. Technology Stack

| Category | Technology | Version |
|---|---|---|
| Runtime | Node.js | >= 20.0.0 |
| Language | TypeScript (strict) | ^5.3.3 |
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
│   ├── index.ts                    # Worker entrypoint (Telegram + Health server)
│   ├── config.ts                   # Zod env validation + Config proxy
│   └── arbitrage/
│       ├── adapters/               # Marketplace scrapers (HTTP + CDP/Chromium)
│       │   ├── base-adapter.ts     # SSRF firewall, rate limiting, retry logic
│       │   ├── shopee-adapter.ts
│       │   ├── tokopedia-browser-adapter.ts
│       │   ├── lazada-browser-adapter.ts
│       │   ├── blibli-adapter.ts
│       │   └── tiktokshop-adapter.ts
│       ├── db/
│       │   ├── connection.ts       # Supabase/URI/PG_* resolver
│       │   ├── pool.ts             # Shared pool + health check
│       │   ├── migrate.ts          # Migration runner (idempotent, transactional)
│       │   ├── verify-supabase.ts  # Runtime 16-check verification
│       │   └── migrations/0001-core-foundation.sql
│       ├── economic/               # Financial engines (Decimal, landed cost, fees, profit)
│       ├── intelligence/           # Market-clearing, demand, competition, risk, EV, decay, learning
│       ├── observability/          # Health server + 15 Prometheus metrics + alerts
│       ├── provenance/             # Data provenance taxonomy + freshness controls
│       ├── pipeline/               # Orchestrator + 16 decision gates
│       ├── reliability/            # Circuit breaker state machine + wiring
│       ├── sourcing/               # Supplier adapter contract + fixture + harness
│       └── lib/                    # Logger, hash, ulid, utils, constants, price
├── scripts/
│   ├── deploy.sh                   # Build → test → flyctl deploy → verify
│   ├── observe-production.sh       # 7-day hourly metrics collection
│   ├── rollback.sh                 # flyctl rollback
│   ├── verify-production.sh        # 130-line production readiness check
│   ├── schema-audit.ts             # Live DB schema vs migration validation
│   └── analyze-observations.py     # Prometheus metrics parsing
├── fly.toml                        # Fly.io deployment configuration
├── Dockerfile                      # Multi-stage Docker build (incl. Chromium)
├── .dockerignore
├── docker-compose.yml              # Local PostgreSQL + worker
├── .github/workflows/ci.yml        # CI pipeline (typecheck, lint, build, test, coverage, security)
├── package.json
├── tsconfig.json
├── LICENSE                         # MIT
└── README.md
```

---

## 6. Supabase Setup

### 6.1 Create a Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project.
2. Set a strong database password.
3. Wait for provisioning to complete.

### 6.2 Get the connection string

- Dashboard → Project → Settings → Database → **Connection string** → **URI**.
- For the **worker**: use the **pooled** connection (port **6543**). Append `?sslmode=require`.
- For **migrations**: use the **direct** connection (port **5432**) for DDL reliability.

### 6.3 Configure environment

Create a `.env` file with the required variables (see Environment Variables below). Set `SUPABASE_DATABASE_URL` to your pooled connection string.

### 6.4 Apply migration

```bash
npm run migrate
```

The migration is idempotent, transactional, and records a SHA-256 checksum per file in `schema_migrations`.

### 6.5 Verify the connection

```bash
npm run verify:supabase
```

Runs 16 checks (connectivity, TLS, auth, SELECT/INSERT/UPDATE/DELETE, transaction commit/rollback, FK/unique enforcement, concurrent access, reconnect, persistence, migration state, schema version) against a scratch table. Exit 0 on full PASS.

---

## 7. Environment Variables

**No `.env.example` file exists in the repository.** Create a `.env` file manually. Never commit `.env*` files.

### Database (resolution order: first non-empty wins)

| Variable | Required? | Default | Description |
|---|---|---|---|
| `SUPABASE_DATABASE_URL` | preferred prod | — | Supabase PostgreSQL pooled/direct URI |
| `DATABASE_URL` | optional | — | Any standard PostgreSQL URI |
| `PG_HOST` | local fallback | `localhost` | PostgreSQL host |
| `PG_PORT` | local fallback | `5432` | PostgreSQL port |
| `PG_USER` | local fallback | `""` | PostgreSQL user |
| `PG_PASSWORD` | local fallback | `""` | PostgreSQL password |
| `PG_DATABASE` | local fallback | `""` | PostgreSQL database name |
| `PG_SSL_MODE` | local fallback | `disable` | `disable` / `require` / `verify-full` |
| `PG_POOL_MAX` | optional | — | Max pool connections |

### Application

| Variable | Required? | Default | Description |
|---|---|---|---|
| `APPLICATION_ENV` | optional | `development` | `development` / `test` / `production` |
| `WORKER_MODE` | worker only | `false` | Must be `true` on Fly.io |
| `ADMIN_API_KEY` | recommended | `""` | Bearer token for `/health` and `/metrics` |
| `LOG_LEVEL` | optional | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |

### Telegram (worker only)

| Variable | Required? | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | worker ✅ | `""` | Bot token from @BotFather |
| `ALLOWED_USER_IDS` | recommended | `""` | Comma-separated authorized Telegram user IDs |

### Scraping Configuration

| Variable | Default | Description |
|---|---|---|
| `SCRAPER_REQUEST_TIMEOUT_MS` | `15000` | Request timeout (ms) |
| `SCRAPER_DELAY_MIN_MS` | `1000` | Minimum delay between requests (ms) |
| `SCRAPER_DELAY_MAX_MS` | `3000` | Maximum delay between requests (ms) |
| `MAX_CONCURRENT_REQUESTS` | `5` | Max concurrent scraping requests |
| `SSRF_FIREWALL_ENABLED` | `true` | SSRF protection (do not disable in prod) |
| `SCRAPER_PROXY_URL` | — | Optional proxy URL (not in config schema) |

### Operational

| Variable | Default | Description |
|---|---|---|
| `HEALTH_PORT` | `9090` | Worker health server port |
| `MAX_SEARCH_RESULTS` | `10` | Max search results per query |
| `NOTIFICATION_CHECK_INTERVAL_SEC` | `300` | Bot notification interval |
| `REDIS_URL` | `redis://localhost:6379/0` | Parsed; not used at runtime |
| `DATABASE_PATH` | `./data/belibot.db` | Legacy SQLite (worker only) |
| `PG_SKIP_OK` | `true` | Skip PG tests when DB unavailable |

### Supplier Adapter Secrets

| Variable | Default | Description |
|---|---|---|
| `ALIBABA_API_KEY` | `""` | Alibaba International API key |
| `ALIBABA_API_URL` | `https://api.alibaba.com/v2` | Alibaba API base URL |

### CAPTCHA

| Variable | Default | Description |
|---|---|---|
| `TWO_CAPTCHA_API_KEY` | `""` | 2Captcha API key |
| `CAPTCHA_TIMEOUT_MS` | `300000` | CAPTCHA solve timeout (ms) |

### Alerting

| Variable | Default | Description |
|---|---|---|
| `ALERT_CHANNEL` | `log` | `telegram` / `log` |
| `ALERT_CHAT_ID` | `""` | Telegram chat ID for alerts |
| `ALERT_INTERVAL_MS` | `300000` | Alert evaluation interval (ms) |
| `ALERT_MIN_SEVERITY` | `medium` | `low` / `medium` / `high` / `critical` |

---

## 8. Database Migration

```bash
npm run migrate
```

- Runs `src/arbitrage/db/migrate.ts` via `tsx`.
- Idempotent: already-applied migrations are skipped.
- Transactional per file (`BEGIN`/`COMMIT`; `ROLLBACK` on error).
- Records SHA-256 checksums in `schema_migrations`.
- Connection resolution: `SUPABASE_DATABASE_URL → DATABASE_URL → PG_*`.

**Rollback:** Forward-only (no down-migrations). Back up with `pg_dump` before applying to production.

---

## 9. Database Schema

The migration (`0001-core-foundation.sql`, 715 lines) creates 28 tables organized into 5 groups:

**Ingestion & Raw (4 tables):** `sources`, `source_health`, `crawl_jobs`, `crawl_events`, `raw_documents`, `raw_products`

**Core Entities (5 tables):** `suppliers`, `supplier_contacts`, `supplier_products`, `supplier_prices`, `products`, `product_variants`, `product_matches`

**Marketplace & Intel (4 tables):** `marketplaces` (5 seeded rows), `marketplace_listings`, `marketplace_prices`, `demand_signals`, `competition_snapshots`

**Economics & Decisions (4 tables):** `cost_models` (11-component landed cost), `profit_models` (dual-engine), `sensitivity_models` (N×N grid), `opportunities`, `opportunity_scores`, `test_orders`

**Learning & Audit (4 tables):** `sales_actuals`, `profit_attribution`, `model_calibrations`, `audit_logs`

**Schema tracking:** `schema_migrations`

**Design:** All PKs are ULIDs (`VARCHAR(26)`), all financial amounts use `NUMERIC(18,4)`, all timestamps are `TIMESTAMPTZ`, 27 foreign keys, 98 indexes, 7 ENUM types.

---

## 10. Running Tests

```bash
npm test                    # 696 tests passing (40 PG-dependent tests skip without DB)
npm run test:watch          # Watch mode
npm run test:coverage       # 85.62% statements
```

Targeted:
```bash
npx jest src/arbitrage/db/connection.test.ts
npx jest src/arbitrage/pipeline/pipeline-scenarios.test.ts
```

> PostgreSQL integration tests require a running DB. Without it, they skip (not pass) when `PG_SKIP_OK=true`. CI sets `PG_SKIP_OK=false` so they fail if the DB is down.

---

## 11. Typecheck / Build / Lint

```bash
npx tsc --noEmit             # typecheck
npm run build                # build → dist/
npm run lint                 # eslint src --ext .ts
```

---

## 12. Local Development

### Option A — Supabase cloud (preferred)

1. Create a Supabase project.
2. Create a `.env` file with `SUPABASE_DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`, `ADMIN_API_KEY`.
3. `npm run migrate`.
4. `npm run verify:supabase`.
5. `npm test`.
6. `npm run dev`.

### Option B — Local PostgreSQL/Docker (fallback)

```bash
docker compose up -d postgres   # PG 16 on :5433
# .env: set PG_HOST=localhost PG_PORT=5433 PG_USER=marketintele_app PG_PASSWORD=... PG_DATABASE=marketintele
npm run migrate
npm test
npm run dev
```

---

## 13. Starting the Application (Worker)

```bash
WORKER_MODE=true npm start     # node dist/index.js (production)
npm run dev                    # tsx watch (development)
```

Startup sequence: Zod config → `requireWorkerConfig()` (throws if no Telegram token) → SQLite init → PostgreSQL health check → fee validation → adapter registration → supplier adapter registration → circuit breaker wiring → alert manager → health server `:9090` → Telegram `bot.launch()`.

- SQLite is **required** (user prefs). Failure exits 1.
- PostgreSQL is **health-checked**, not required to boot — degraded mode if unreachable.
- Graceful shutdown: `SIGINT`/`SIGTERM` → stop health server → close PG pool → stop bot → `adapterRegistry.shutdownAll()` → exit 0.

---

## 14. Health Checks

| Endpoint | Auth | Success | Failure |
|---|---|---|---|
| `GET /live` | None | 200 `{status:"alive",uptime,timestamp}` | — |
| `GET /ready` | None | 200 `{status:"ready",dependencies}` | 503 `{status:"not_ready",...}` |
| `GET /health` | Bearer | 200 `{status,checks,uptime,version}` | 200 with degraded status |
| `GET /metrics` | Bearer | 200 Prometheus text | — |

---

## 15. Metrics & Observability

15 Prometheus metrics exposed at `/metrics`:

| Metric | Type | Description |
|---|---|---|
| `pipeline_runs_total` | counter | Total pipeline runs |
| `pipeline_success_total` | counter | Successful pipeline runs |
| `pipeline_failure_total` | counter | Failed pipeline runs |
| `pipeline_duration_seconds` | histogram | Pipeline execution duration |
| `adapter_requests_total` | labeled counter | Adapter requests (adapter, status) |
| `adapter_failures_total` | labeled counter | Adapter failures (adapter, error_type) |
| `supplier_resolution_total` | counter | Supplier resolution attempts |
| `opportunities_discovered_total` | counter | Opportunities discovered |
| `opportunities_rejected_total` | counter | Opportunities rejected by gates |
| `opportunities_verified_total` | counter | Opportunities verified (RECOMMEND) |
| `database_errors_total` | counter | Database errors |
| `circuit_breaker_trips_total` | counter | Circuit breaker trips to OPEN |
| `captcha_detections_total` | counter | CAPTCHA detections |
| `captcha_solves_total` | counter | CAPTCHA solves |
| `captcha_failures_total` | counter | CAPTCHA solve failures |

---

## 16. Fly.io Deployment

### Configure Secrets

```bash
flyctl secrets set \
  TELEGRAM_BOT_TOKEN="<your-token>" \
  SUPABASE_DATABASE_URL="postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require" \
  ADMIN_API_KEY="<strong-random-key>" \
  ALLOWED_USER_IDS="<your-user-id>" \
  LOG_LEVEL="info" \
  SSRF_FIREWALL_ENABLED="true"
```

### Deploy

```bash
flyctl deploy
```

### Verify

```bash
flyctl status
flyctl checks list
flyctl ssh console
curl -H "Authorization: Bearer <ADMIN_API_KEY>" http://localhost:9090/health
flyctl logs --tail
```

### Rollback

```bash
flyctl rollback --previous
```

---

## 17. Docker Deployment

```bash
docker build -t marketintele-worker .
docker run -d --env-file .env -p 9090:9090 marketintele-worker
```

Or with `docker-compose.yml`:
```bash
docker compose up -d
```

The Dockerfile is multi-stage, runs as a non-root user `marketintele`, includes a HEALTHCHECK, and exposes 9090. For production, set `WORKER_MODE=true`, `TELEGRAM_BOT_TOKEN`, `SUPABASE_DATABASE_URL` (pooled, port 6543), `ALLOWED_USER_IDS`, and `ADMIN_API_KEY` in the container env.

---

## 18. CI/CD

`.github/workflows/ci.yml` runs on push/PR:

**Quality job:** `npm ci` → PostgreSQL 16 service container → `npm run migrate` → `npm run verify:supabase` → `npx tsc --noEmit` → `npx eslint src --ext .ts --quiet` → `npm run build` → `npx jest --coverage` → upload coverage artifact.

**Security scan job:** Secret scan (AWS keys, GitHub tokens, Slack tokens, Telegram tokens) → `npm audit --audit-level=moderate`.

CI sets `PG_SKIP_OK=false` so DB tests fail (not silently pass) if PostgreSQL is unreachable.

---

## 19. Security

- SSRF firewall: IPv4/IPv6 private range blocking, DNS resolution, metadata endpoint blocking, redirect re-validation, protocol restriction (HTTP/HTTPS only), redirect limit (3 hops).
- Telegram authorization: `ALLOWED_USER_IDS` check on every command.
- Health endpoint auth: `/health` and `/metrics` require `Authorization: Bearer <ADMIN_API_KEY>` (constant-time comparison).
- `/live` and `/ready` are unprotected (used by Fly.io health checks).
- Zod validates all config; worker guard fails fast without Telegram token.
- Logs redact secrets (`password`, `token`, `secret`, `PG_PASSWORD`, `TELEGRAM_BOT_TOKEN`).
- `.env*` files are gitignored.
- RLS **not enabled** (no browser→Supabase path today).

---

## 20. Telegram Bot Commands

| Command | Category | Purpose |
|---|---|---|
| `/start` | Onboarding | Welcome message + available commands |
| `/help` | System | Full help text (Indonesian) |
| `/arbitrage <query> [marketplace]` | Core Discovery | Runs full arbitrage pipeline |
| `/status` | System | Worker & adapter status |
| `/health` | System | Health check info |
| `/setbudget <nominal>` | Settings | Sets user budget (SQLite) |
| `/setmarketplace <name>` | Settings | Selects active marketplace (SQLite) |
| `/setkategori <name>` | Settings | Sets category filter (SQLite) |
| `/setnotifikasi on/off` | Settings | Toggle notifications (SQLite) |
| `/history` | System | Last 10 arbitrage analyses (SQLite) |
| `/cari`, `/rp0`, `/murah` | Legacy | Deprecated, redirects to `/arbitrage` |

**Authorization:** Checked against `ALLOWED_USER_IDS`. Unauthorized users see "Akses ditolak."

**Response categories for `/arbitrage`:**
1. **MARKETPLACE DATA UNAVAILABLE** — Discovery found no usable products
2. **SUPPLIER DATA UNAVAILABLE** — Marketplace data found but no supplier price (fail-closed)
3. **NO ARBITRAGE OPPORTUNITY** — Valid data but decision gates failed
4. **REAL OPPORTUNITY** — Decision RECOMMEND

---

## 21. Marketplace Scraping Strategy

MarketIntele uses web scraping (not official APIs) for marketplace data extraction.

| Marketplace | Method | Tool | Status |
|---|---|---|---|
| **Shopee** | HTTP | axios + cheerio | PRODUCTION |
| **Tokopedia** | Browser (CDP) | Puppeteer/Chromium | PRODUCTION |
| **Lazada** | Browser (CDP) | Puppeteer/Chromium | PRODUCTION |
| **Blibli** | HTTP | axios + cheerio | BETA |
| **TikTok Shop** | HTTP | axios + cheerio | BETA |

### Anti-Blocking Strategies

- User-Agent rotation (10+ variants)
- Request delays (1-3s randomized)
- Retry with exponential backoff (3 retries)
- Browser fingerprinting (viewport, Accept-Language, headers)
- Circuit breaker per adapter (5 failures → OPEN, 60s cooldown)
- Optional proxy support
- SSRF firewall enabled by default

---

## 22. Pipeline Architecture

The pipeline executes 16 stages end-to-end:

```
1. Discovery          → Marketplace adapter search + fetch + parse + normalize
2. Market Clearing    → Multi-listing aggregation with outlier rejection
3. Matching           → Product identity matching
4. Supplier Sourcing  → B2B adapter or marketplace-seller derivation
5. Landed Cost        → 10-component cost model (UNKNOWN throws)
6. Marketplace Fees   → Fee schedule per marketplace
7. Profit (Dual)      → Twin-engine independent calculation + reconciliation
8. Demand             → Demand signal classification
9. Competition        → HHI, price war risk, saturation
10. Risk              → 4-dimension risk assessment
11. Comprehensive Risk → 11-dimension risk assessment
12. Decay             → Half-life decay, freshness TTL enforcement
13. Expected Value    → BEAR/BASE/BULL scenario-weighted EV
14. Decision          → 16 gates (C01-C15 + C13b)
15. Format            → Telegram message formatting
16. Metrics           → Prometheus counter/histogram recording
```

### Decision Gates (C01-C15 + C13b)

| Gate | Name | Critical | Description |
|---|---|---|---|
| C01 | Product Identity Verified | Yes | Brand + barcode present |
| C02 | Supplier Identity Verified | Yes | Supplier verified, risk not CRITICAL |
| C03 | Unit/Package Equivalence | Yes | Package quantity known |
| C04 | Price and MOQ Validity | Yes | Price > 0, MOQ ≥ 1 |
| C05 | Marketplace Comparability | Yes | Evidence hierarchy level ≥ 3 |
| C06 | Market Clearing Price | Yes | Clearing price with ≥ MEDIUM confidence |
| C07 | Landed Cost Complete | Yes | No UNKNOWN cost components |
| C08 | Marketplace Fees Configured | Yes | Fee > 0 |
| C09 | Independent Profit Match | Yes | Dual-engine reconciled, profit positive |
| C10 | Demand Evidence | No | Demand score + confidence > 0.2 |
| C11 | Competition Saturation | No | Not EXTREME, price war not HIGH |
| C12 | Risk Thresholds | Yes | Overall risk not CRITICAL |
| C13 | Data Freshness TTL | Yes | Observation within 24h max age |
| C13b | Provenance Eligible | Yes | Only REAL_* categories allowed |
| C14 | Sensitivity Robustness | Yes | MODERATE or better robustness |
| C15 | Confidence Above Floor | Yes | Product confidence ≥ floor |

**Decision outcome:** Any critical gate fail → REJECT. All critical pass + any warning fail → REVIEW. All pass → RECOMMEND.

**Quality tiers:** S-TIER (ROI ≥ 50%, margin ≥ 15%), A-TIER (ROI ≥ 30%, margin ≥ 10%), B-TIER (ROI ≥ 15%, margin ≥ 5%), C-TIER (below thresholds), REJECTED.

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

### Landed Cost Calculation

```
Landed Cost = Supplier Base Cost
            + Inbound Logistics
            + Import Duties/Tariffs
            + Value Added Tax
            + Customs Clearance
            + Supplier Payment Processing Fee
            + Inbound Packaging Materials
            + Quality Inspection Cost
            + Wastage & Defect Reserve
            + Handling/Warehousing (Inbound)
```

All 10 components must be explicitly provided. Missing components throw `UncalculatedCostException`.

---

## 24. Data Provenance

Every marketplace observation carries a provenance category:

| Category | Production Eligible |
|---|---|
| `REAL_OFFICIAL_API` | Yes |
| `REAL_PUBLIC_WEB` | Yes |
| `REAL_PUBLIC_ENDPOINT` | Yes |
| `TEST_FIXTURE` | No |
| `MOCK` | No |
| `SIMULATION` | No |

Only `REAL_*` categories can produce production opportunities (C13b gate). `TEST_FIXTURE` offers are stamped with `TEST_FIXTURE — NOT REAL DATA` evidence.

**Freshness:** Observations older than 24 hours (configurable) are marked STALE and blocked by C13.

---

## 25. Circuit Breaker

The circuit breaker is **wired at bootstrap** for all marketplace and supplier adapters:

- **Marketplace adapters:** 5 failures → OPEN, 60s recovery, 2 half-open successes to close
- **Supplier adapters:** 3 failures → OPEN, 120s recovery, 2 half-open successes to close

State machine: CLOSED → OPEN → HALF_OPEN → CLOSED. Trips are recorded in Prometheus metrics (`circuit_breaker_trips_total`).

---

## 26. Known Limitations

| Area | Status | Detail |
|---|---|---|
| Real supplier adapter | NOT_TESTED | No B2B API credentials or supplier scraping verified in production |
| Marketplace scraping | DEPLOYED + VERIFIED | 5 adapters, anti-blocking, runtime verified |
| CAPTCHA handling | MANUAL | Detection implemented, requires manual resolution |
| HTML structure change | WARNING | No automated detection, needs monitoring |
| Model calibration | NOT_TESTED | No historical realized-profit data |
| Dead-letter queue | NOT_IMPLEMENTED | No async queue |
| Migration rollback | NOT_IMPLEMENTED | Forward-only |
| `.env.example` | MISSING | No `.env.example` file exists in the repository |


---

## 27. Production Readiness

**Infrastructure:** Build, typecheck, lint, tests, coverage — all PASS.  
**Database:** PostgreSQL 16, 28 tables, migration, verification — DEPLOYED + VERIFIED.  
**Deployment:** Fly.io worker, health checks, graceful shutdown — DEPLOYED.  
**Security:** SSRF firewall, Bearer auth, Telegram authorization — IMPLEMENTED.  
**Observability:** 15 Prometheus metrics, health endpoints, structured logging — DEPLOYED.  
**Circuit breaker:** Wired at bootstrap per adapter — IMPLEMENTED.  
**Supplier sourcing:** 21 failure-injection tests, contract verified — NOT_TESTED in production.  
**CAPTCHA:** Auto-resolution not implemented — MANUAL.  

**Production Gate: `INFRASTRUCTURE_READY`** — Infrastructure, marketplace scraping, database, and security are deployed and verified. P1 item: real supplier adapter.

---

## 28. Scripts

| Script | Purpose |
|---|---|
| `scripts/deploy.sh` | Build → test → flyctl deploy → verify |
| `scripts/rollback.sh` | flyctl rollback --previous |
| `scripts/observe-production.sh` | 7-day hourly /health + /metrics collection |
| `scripts/verify-production.sh` | 10-category production readiness check |
| `scripts/schema-audit.ts` | Live DB schema vs migration validation |
| `scripts/analyze-observations.py` | Parse Prometheus metrics from observation directory |

---

## 29. Troubleshooting

| Symptom | Fix |
|---|---|
| `DbConfigError: No database configuration found` | Set `SUPABASE_DATABASE_URL` or `PG_*` |
| Migration `ECONNREFUSED` | Start PostgreSQL (`docker compose up -d postgres`) or verify Supabase URI |
| `/ready` returns 503 | PostgreSQL or adapters not ready |
| `/health` returns 401 | Missing/wrong `Authorization: Bearer <token>` header |
| Telegram `401 Unauthorized` | Invalid `TELEGRAM_BOT_TOKEN`; regenerate via @BotFather |
| `⛔ Akses ditolak` | User not in `ALLOWED_USER_IDS` |
| Browser crashes on Fly.io | Chromium out of memory; scale to `shared-cpu-2x` |
| `TELEGRAM_BOT_TOKEN is required` | Bot token not set; set `WORKER_MODE` and `TELEGRAM_BOT_TOKEN` |

---

## 30. License

MIT License — see [LICENSE](./LICENSE).

---

## 31. Disclaimer

This system provides sourcing and arbitrage intelligence. It does **not** guarantee profit. Fixture data is not production evidence. Any decision made using this system's output is the sole responsibility of the operator.