# AI Product Sourcing & Marketplace Arbitrage Intelligence Engine

**Version:** 2.0.0  
**Target Market:** Indonesia  
**Production Gate:** `NOT_READY`  
**Audit Baseline:** `FINAL_PRODUCTION_AUDIT_V3.md` (2026-08-15)  
**Migration Plan:** `ARCHITECTURE_MIGRATION_PLAN.md` (2026-08-16)

A TypeScript arbitrage intelligence engine that discovers products on Indonesian marketplaces (Shopee, Tokopedia, Lazada, Blibli, TikTok Shop), sources them from B2B suppliers, and computes risk-adjusted profit opportunities through a fail-closed, financially-integrity-first pipeline.

> **Read this first.** This README documents the system **as it actually exists today** and distinguishes **IMPLEMENTED** from **TESTED** from **RUNTIME_VERIFIED** from **PRODUCTION_READY**. The current gate is `NOT_READY` because real supplier/marketplace API credentials are not available — see [§2 Current Status](#2-current-project-status) and [§31 Production Readiness](#31-production-readiness).

---

## Architecture at a Glance

The system is split into three deployment surfaces that share one business-logic core:

```
┌──────────────────────── VERCEL (serverless) ────────────────────────┐
│  /api/health  /api/live  /api/ready  /api/metrics                    │
│  /api/opportunities  /api/suppliers  /api/products  /api/audit       │
│  Thin HTTP handlers → shared engine (src/arbitrage/**) → DB layer     │
│  No Telegram, no SQLite, no long polling, no setInterval.            │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ TLS (serverless-safe pooled PG)
                                   ▼
┌──────────────────────── SUPABASE (PostgreSQL 16) ─────────────────────┐
│  28 tables + schema_migrations, 27 FKs, 98 indexes, NUMERIC(18,4)    │
│  PgBouncer (port 6543) for serverless; direct (5432) for worker/DDL.  │
└──────────────────────────────────▲───────────────────────────────────┘
                                   │ pooled PG conn (direct)
┌──────────────────────── WORKER (persistent process) ────────────────┐
│  src/index.ts → Telegram bot.launch() (long polling)                 │
│              → health/metrics server on :9090                         │
│              → legacy SQLite (user prefs)                             │
│              → marketplace adapters (crawlers)                        │
│              → arbitrage pipeline (invoked by /arbitrage command)     │
│  Deployed via Docker (Dockerfile) / VPS / container host. NOT Vercel.│
└──────────────────────────────────────────────────────────────────────┘
```

**Why this split?** Telegram long polling, crawlers, retry loops, and circuit-breaker state require a persistent process and are incompatible with Vercel serverless functions. The web/API surface is naturally stateless and serverless-compatible. Both surfaces reuse the **same** financial engine, intelligence engines, sourcing service, and DB layer — there is no duplicated business logic.

---

## Quick Start (Supabase + Local Worker)

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
# Edit .env.local: set SUPABASE_DATABASE_URL, TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS

# 4. Apply database migration to Supabase
npm run migrate

# 5. Verify the database connection end-to-end
npm run verify:supabase

# 6. Typecheck, build, test
npx tsc --noEmit
npm run build
npm test            # 545/545 tests pass, 34 suites

# 7. Start the worker (Telegram bot + health server on :9090)
WORKER_MODE=true npm start

# 8. Verify health (separate terminal)
curl http://localhost:9090/live
curl http://localhost:9090/ready
curl http://localhost:9090/metrics
```

> **Local PostgreSQL fallback:** If you prefer not to use Supabase, set `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` instead and run `docker compose up -d postgres`. The DB layer resolves `SUPABASE_DATABASE_URL → DATABASE_URL → PG_*` in that order. See [§14 Local Development](#14-local-development).

> **TEST_FIXTURE ≠ production data.** Fixture results prove the pipeline mechanics work; they do **not** prove real-world arbitrage profitability. See [§22 TEST_FIXTURE Mode](#22-test_fixture-mode).

---

## 1. Overview

MarketIntele is an arbitrage intelligence engine that answers:

> *"Can I buy product X from a B2B supplier at cost C, sell it on marketplace M at the market clearing price P, and realize a risk-adjusted profit after landed cost, fees, returns, and competition?"*

The system enforces a strict **fail-closed** philosophy: when a mandatory economic input is `UNKNOWN`, it stays `UNKNOWN` — never silently coerced to `0`. A missing supplier cost never produces a positive opportunity.

### The arbitrage distinction

| Entity | Meaning | Source |
|---|---|---|
| **MARKET_PRICE** | Retail listing price on a marketplace | Marketplace adapter (Shopee, Tokopedia, …) |
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
| Build | **PASS** | `npm run build` → exit 0; `npm run build:api` → exit 0 |
| Typecheck | **PASS** | `npx tsc --noEmit` → exit 0; `npm run typecheck:api` → exit 0 |
| Tests | **PASS** | `npm test` → 545/545 pass, 34 suites, exit 0 |
| Coverage | **PASS** | 85.62% statements (threshold 80% met) |
| Lint | **PASS** | `npx eslint src --ext .ts --quiet` → 0 errors |
| Financial Integrity | **PASS** | UNKNOWN≠0, Decimal precision 28, dual-engine, NaN rejected |
| Supabase DB layer | **IMPLEMENTED + DEPLOYED** | Connection resolver, migration, verify command; runtime verified against live Supabase (16/16 PASS) |
| Vercel API layer | **DEPLOYED + VERIFIED** | 8 routes, admin guard, method guards, route tests; production deployment validated (live smoke test PASS) |
| Supplier Sourcing | **INTEGRATION_VERIFIED** | Contract complete, 21 failure-injection tests; real runtime **NOT_TESTED** |
| Marketplace Integration | **IMPLEMENTED** | 5 adapters coded; HTTP calls **NOT_TESTED** (no live API access) |
| PostgreSQL | **RUNTIME_VERIFIED** | 28 integration tests against PostgreSQL 16 (when DB available) |
| Security | **PASS** | 64 SSRF/security tests + admin API key guard |
| Observability | **TESTED** | /live, /ready, /health, /metrics + 12 metrics, 17 tests |
| Production Gate | **NOT_READY** | P0=0, P1=3 (supplier runtime, marketplace HTTP, no real data) |

---

## 3. Deployment Surfaces

### 3.1 Vercel (API / Web)

Vercel hosts the stateless HTTP API. Files live in `api/`:

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/health` | GET | none | Aggregate health (no secrets) |
| `/api/live` | GET | none | Liveness probe |
| `/api/ready` | GET | none | Readiness (PG + adapters) |
| `/api/metrics` | GET | none | Prometheus text format |
| `/api/opportunities` | GET | none | Read-only opportunity listing (paginated) |
| `/api/suppliers` | GET | none | Read-only supplier listing |
| `/api/products` | GET | none | Read-only product listing |
| `/api/audit` | GET | `x-admin-api-key` | Admin status (migration version, row counts) |

- Each handler imports the **shared engine** from `src/arbitrage/**`.
- No handler imports `telegraf` or `better-sqlite3`.
- Each serverless invocation uses a short-lived DB pool (closed in `finally`) to avoid connection exhaustion.
- Admin endpoints require the `ADMIN_API_KEY` env var and an `x-admin-api-key` header (constant-time compare).

### 3.2 Worker (Telegram + Crawlers)

The persistent worker runs `src/index.ts`:

- Telegram `bot.launch()` long polling.
- Health/metrics server on `:9090`.
- Legacy SQLite (user preferences/promo history).
- Marketplace adapters (crawlers) invoked by the `/arbitrage` command.
- Arbitrage pipeline.

Deployed via Docker (`Dockerfile`) on a VPS or any container host. **Not** deployed to Vercel. The worker guard (`requireWorkerConfig`) fails fast if `TELEGRAM_BOT_TOKEN` is missing.

### 3.3 Supabase (Database)

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
| IDs | ulid | ^2.3.0 |
| API hosting | Vercel (serverless Node) | — |
| Worker hosting | Docker / VPS / container host | — |
| Testing | Jest + ts-jest | ^30 / ^29 |
| Linting | ESLint + @typescript-eslint | ^8 / ^6 |

---

## 5. Repository Structure

```
marketintele/
├── api/                        # Vercel serverless functions (NEW)
│   ├── _lib/http.ts            # shared API helpers (json, admin guard, serverless pool)
│   ├── health.ts  live.ts  ready.ts  metrics.ts
│   ├── opportunities.ts  suppliers.ts  products.ts  audit.ts
│   └── api.test.ts
├── src/
│   ├── config.ts               # Zod env validation + requireWorkerConfig
│   ├── index.ts                # worker entrypoint (Telegram + health server)
│   └── arbitrage/
│       ├── db/
│       │   ├── connection.ts   # Supabase/URI/PG_* resolver (NEW)
│       │   ├── pool.ts         # shared pool (refactored to use connection.ts)
│       │   ├── migrate.ts      # migration runner (Supabase-aware)
│       │   ├── verify-supabase.ts  # runtime verification CLI (NEW)
│       │   ├── migrations/0001-core-foundation.sql
│       │   └── *.test.ts
│       ├── adapters/           # marketplace adapters + SSRF base
│       ├── economic/           # financial engines (Decimal, landed cost, fees, profit)
│       ├── intelligence/       # market-clearing, demand, competition, risk, EV, decay, lifecycle, learning
│       ├── observability/      # health + metrics
│       ├── pipeline/           # orchestrator + decision gates
│       ├── reliability/        # circuit breaker
│       ├── sourcing/           # supplier adapter contract + fixture + harness
│       └── lib/                # logger, hash, ulid, utils
├── vercel.json                 # Vercel config (NEW)
├── tsconfig.api.json           # API build config (NEW)
├── Dockerfile                  # worker image
├── docker-compose.yml          # local PostgreSQL + worker
├── .github/workflows/ci.yml   # CI pipeline
├── .env.example
├── ARCHITECTURE_MIGRATION_PLAN.md
└── FINAL_SUPABASE_VERCEL_MIGRATION_REPORT.md
```

---

## 6. Supabase Setup

### 6.1 Create a Supabase project

1. Sign in at [supabase.com](https://supabase.com) and create a new project.
2. Set a strong database password.
3. Wait for provisioning to complete.

### 6.2 Get the connection string

- Dashboard → Project → Settings → Database → **Connection string** → **URI**.
- For **serverless (Vercel)**: use the **pooled** connection (port **6543**). Append `?sslmode=require`.
- For the **worker / migrations**: use the **direct** connection (port **5432**) for DDL reliability. Append `?sslmode=require`.

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
#   ADMIN_API_KEY=<strong random value for /api/audit>
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
| `PG_POOL_MAX` | optional | Max pool connections (serverless: 3; worker: 10) |

### Application

| Variable | Required? | Purpose |
|---|---|---|
| `APPLICATION_ENV` | optional | `development` / `test` / `production` |
| `WORKER_MODE` | worker only | `true` on the worker; unset/false on Vercel |
| `ADMIN_API_KEY` | `/api/audit` | Strong random value; sent as `x-admin-api-key` header |

### Telegram (worker only)

| Variable | Required? | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | worker ✅ / API ❌ | Bot token from @BotFather |
| `ALLOWED_USER_IDS` | recommended | Comma-separated authorized Telegram user IDs |

### Supabase (documented; JS client not used today)

| Variable | Required? | Purpose |
|---|---|---|
| `SUPABASE_URL` | optional | Project URL (future browser/RLS) |
| `SUPABASE_ANON_KEY` | optional | Anon key (future browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only | **Never** ship to client |

### Operational (preserved)

| Variable | Default | Purpose |
|---|---|---|
| `SSRF_FIREWALL_ENABLED` | `true` | SSRF protection toggle (do not disable in prod) |
| `HEALTH_PORT` | `9090` | Worker health server port |
| `PG_SKIP_OK` | `true` | Skip (not pass) PG tests when DB unavailable |
| `LOG_LEVEL` | `info` | trace/debug/info/warn/error/fatal |
| `SCRAPER_*` / `MAX_CONCURRENT_REQUESTS` | see `.env.example` | Scraper tuning |
| `MAX_SEARCH_RESULTS` / `NOTIFICATION_CHECK_INTERVAL_SEC` | 10 / 300 | Bot behavior |
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
npm test                    # 545/545, 34 suites
npm run test:watch
npm run test:coverage       # 85.62% statements
```

Targeted:
```bash
npx jest src/arbitrage/db/connection.test.ts   # connection resolver
npx jest api/api.test.ts                       # API routes
npx jest src/arbitrage/db/pg-integration.test  # PostgreSQL (needs DB)
npx jest src/arbitrage/pipeline/pipeline-scenarios.test.ts
```

> PostgreSQL integration tests require a running DB matching your `.env`. Without it, they skip (not pass) when `PG_SKIP_OK=true`. CI sets `PG_SKIP_OK=false` so they fail if the DB is down.

---

## 11. Typecheck / Build / Lint

```bash
npx tsc --noEmit             # typecheck src
npm run typecheck:api        # typecheck api + shared
npm run build               # build src → dist/
npm run build:api           # build api → dist-api/
npx eslint src --ext .ts --quiet
```

---

## 12. Local Development

### Option A — Supabase cloud (preferred)

1. Create a Supabase project (§6).
2. `cp .env.example .env.local`; set `SUPABASE_DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`.
3. `npm run migrate`.
4. `npm run verify:supabase`.
5. `npm test`.
6. `npm run dev` (worker) and/or `vercel dev` (API).

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

On Vercel, the same data is exposed at `/api/health`, `/api/live`, `/api/ready`, `/api/metrics`.

---

## 15. Metrics & Observability

12 Prometheus metrics (see [§21](#21-metrics--observability)). Distinguish pipeline requests, DB failures, adapter failures, opportunity generation/rejection, circuit breaker state. Secrets are never exposed (verified by tests).

---

## 16. Vercel Deployment

1. Push the repository to GitHub (or deploy directly via Vercel CLI).
2. Link the project: `vercel link` (auto-detects Node; `requirements.txt` must be absent to avoid Python misdetection).
3. Configure environment variables in Vercel (Project → Settings → Environment Variables, Production):
   - `SUPABASE_DATABASE_URL` (pooled, port 6543, `?pgbouncer=true`; SSL handled in code)
   - `ADMIN_API_KEY`
   - `SSRF_FIREWALL_ENABLED=true`
   - `APPLICATION_ENV=production`
   - `WORKER_MODE=false`
   - Do **NOT** set `NODE_ENV` as a Vercel env var (it breaks `npm ci` by skipping devDependencies like `typescript`); the platform sets it automatically.
   - Do **NOT** set `TELEGRAM_BOT_TOKEN` on Vercel (worker-only).
4. Deploy: `vercel --prod`.
5. Verify: `curl -H "Accept: application/json" https://<project>.vercel.app/api/health`.
6. Disable SSO deployment protection (Project → Settings → Deployment Protection) if the API must be publicly accessible without Vercel auth.

`vercel.json` configures serverless functions for each `api/*.ts` route with 30s max duration. `installCommand: "npm ci --ignore-scripts"` skips the `better-sqlite3` native build (worker-only dependency, not used by the serverless API). No crons are configured (none justified today).

**Production URL:** `https://marketintele-rizki-ramdanis-projects.vercel.app`

**Note on latency:** Vercel functions deploy to `iad1` (Washington, D.C.) by default; Supabase is in `ap-northeast-1` (Tokyo). DB-backed endpoints incur ~1.3–2.4s cross-continent round-trip. To reduce latency, configure the Vercel project region to `hnd1` (Tokyo) to co-locate with Supabase.

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

The Dockerfile is multi-stage, runs as a non-root user, includes a health check, and exposes 9090. For production, set `WORKER_MODE=true`, `TELEGRAM_BOT_TOKEN`, `SUPABASE_DATABASE_URL` (direct, port 5432), and `ALLOWED_USER_IDS` in the container env.

---

## 18. CI/CD

`.github/workflows/ci.yml` runs on push/PR:
1. `npm ci`
2. Start PostgreSQL 16 service container
3. `npm run migrate`
4. `npm run verify:supabase` (with `DATABASE_URL` pointing at the service container)
5. `npx tsc --noEmit` + `npm run typecheck:api`
6. `npx eslint src --ext .ts --quiet`
7. `npm run build` + `npm run build:api`
8. `npx jest --coverage`
9. Secret scan + dependency audit (separate job)

CI sets `PG_SKIP_OK=false` so DB tests **fail** (not silently pass) if PostgreSQL is unreachable.

---

## 19. Security

- `.env` / `.env.local` gitignored; `.env.example` uses placeholders only.
- Zod validates config; worker guard fails fast without Telegram token.
- SSRF firewall on by default (IPv4/IPv6, DNS resolution, redirect re-validation).
- Telegram authorization (`ALLOWED_USER_IDS`) preserved in worker.
- Admin API (`/api/audit`) gated by `ADMIN_API_KEY` (constant-time compare).
- Service-role key never shipped to client; all DB access server-side.
- RLS **not enabled** (no browser→Supabase path today). If a dashboard with direct browser DB access is added, RLS must be turned on.
- Logs redact secrets (`password`, `token`, `secret`, `PG_PASSWORD`, `TELEGRAM_BOT_TOKEN`).

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

## 22. Financial Integrity Model

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

## 23. Known Limitations

| Area | Classification | Detail |
|---|---|---|
| Real supplier adapter | NOT_TESTED | No B2B API credentials |
| Marketplace adapter HTTP | NOT_TESTED | 5 adapters coded; no live API calls |
| Real arbitrage validation | NOT_TESTED | No real supplier/marketplace data |
| Supabase runtime | **DEPLOYED + VERIFIED** | Connection/migration/verify validated against live Supabase Tokyo; 16/16 PASS |
| Vercel deployment | **DEPLOYED + VERIFIED** | Production deployment live; 8 endpoints smoke-tested (all PASS) |
| Telegram bot runtime | NOT_TESTED | Requires valid token to start |
| Dead-letter queue | MISSING | No async queue |
| Migration rollback | NOT_IMPLEMENTED | Forward-only |
| Circuit breaker wiring | NOT_WIRED | Implemented + tested; not called by production code |
| Model calibration | NOT_TESTED | No historical realized-profit data |

---

## 24. Production Readiness

- [x] build, typecheck, lint, tests, coverage
- [x] financial integrity (UNKNOWN≠0, dual-engine, C01–C15)
- [x] PostgreSQL runtime (28 integration tests)
- [x] health/metrics, graceful shutdown
- [x] Supabase DB layer implemented + tested (connection resolver, verify command)
- [x] Vercel API layer implemented + tested (8 routes, admin guard)
- [x] Supabase runtime verified against live project (16/16 PASS)
- [x] Vercel deployment verified (production live, all 8 endpoints smoke-tested PASS)
- [ ] real supplier API runtime (NOT_TESTED)
- [ ] real marketplace API runtime (NOT_TESTED)
- [ ] 7-day production observation (NOT_TESTED)

**Production Gate: `INFRASTRUCTURE_READY`** — Infrastructure, API, database, and security are production-ready and deployed. P1 business-verification items remain: supplier runtime, marketplace HTTP, real arbitrage data. See `FINAL_VERCEL_PRODUCTION_DEPLOYMENT_REPORT.md` for full evidence.

---

## 25. Rollback

- **Code:** `git checkout <previous-tag>` → rebuild → redeploy.
- **DB:** forward-only; restore from pre-migration `pg_dump` backup.
- **Vercel:** instant rollback to previous deployment.
- **Worker:** redeploy previous Docker image.

---

## 26. Troubleshooting

| Symptom | Fix |
|---|---|
| `DbConfigError: No database configuration found` | Set `SUPABASE_DATABASE_URL` or `PG_*` |
| Migration `ECONNREFUSED` | Start PostgreSQL (`docker compose up -d postgres`) or verify Supabase URI |
| `/ready` returns 503 | PostgreSQL or adapters not ready |
| Telegram `401 Unauthorized` | Invalid `TELEGRAM_BOT_TOKEN`; regenerate via @BotFather |
| `⛔ Akses ditolak` | User not in `ALLOWED_USER_IDS` |
| `/api/audit` 503 | `ADMIN_API_KEY` env var not set on Vercel |
| `/api/audit` 401 | Wrong/missing `x-admin-api-key` header |

---

## 27. License

**Not yet specified.** No `LICENSE` file present. All rights reserved until a license is added.

---

## 28. Disclaimer

This system provides sourcing and arbitrage intelligence. It does **not** guarantee profit. Fixture data is not production evidence. Any decision made using this system's output is the sole responsibility of the operator.
