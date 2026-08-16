# Architecture Migration Plan — MarketIntele

**Version:** 1.0  
**Date:** 2026-08-16  
**Scope:** Migrate the application's PostgreSQL architecture to **Supabase PostgreSQL** as the primary cloud database, and prepare **Vercel** deployment for the serverless-compatible components, while keeping persistent workloads (Telegram polling, crawlers, schedulers) in a **worker** process.

This plan is produced **before** any source-code changes, as required by Phase 0 of the master execution prompt. It records the current architecture, the target architecture, and the integration strategy. No code is modified in this phase.

---

## 1. Current Architecture (BEFORE)

### 1.1 Runtime topology

The application is a **single long-running Node.js process** started by `node dist/index.js` (`src/index.ts`). Inside that one process:

```
┌──────────────────────── Application Process (node dist/index.js) ────────────────────────┐
│                                                                                          │
│  1. CONFIG     — Zod env validation (src/config.ts)                                       │
│  2. SQLITE     — legacy belibot DB, REQUIRED to boot (src/legacy/database, better-sqlite3)│
│  3. POSTGRES   — health-checked at boot, runs DEGRADED if unreachable (arbitrage/db/pool) │
│  4. ADAPTERS   — 5 marketplace adapters registered (arbitrage/adapters/registry)          │
│  5. PIPELINE   — arbitrage engine wired to the Telegram /arbitrage command               │
│  6. HEALTH     — http server on :9090 (/live /ready /health /metrics)                     │
│  7. TELEGRAM   — telegraf bot.launch() long-polling (legacy/bot/handlers)                 │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        │                          │                              │
        ▼                          ▼                              ▼
  PostgreSQL 16 (local)     External marketplace APIs        Telegram Bot API
   (Docker / VPS)            (Shopee/Tokopedia/…)             (long polling)
```

### 1.2 Component inventory (verified by source inspection)

| Component | Location | Runtime model | Vercel-compatible? |
|---|---|---|---|
| Config validation (Zod) | `src/config.ts` | eager at import | ✅ (stateless) |
| Legacy SQLite (user prefs/promo history) | `src/legacy/database/` (`better-sqlite3`) | persistent file | ❌ (native binary + filesystem) |
| PostgreSQL pool | `src/arbitrage/db/pool.ts` | long-lived shared `pg.Pool` | ⚠️ (needs per-function pooling) |
| Migration runner | `src/arbitrage/db/migrate.ts` | one-shot script | ✅ (CLI, not serverless) |
| Marketplace adapters (x5) | `src/arbitrage/adapters/*` | HTTP fetch + parse | ⚠️ (stateless but long latency) |
| SSRF firewall / retry / jitter | `src/arbitrage/adapters/base-adapter.ts` | per-request | ✅ (pure functions) |
| Arbitrage pipeline | `src/arbitrage/pipeline/pipeline.ts` | per-request orchestrator | ✅ (stateless, no `setInterval`) |
| Financial engines | `src/arbitrage/economic/**` | pure functions | ✅ |
| Intelligence engines | `src/arbitrage/intelligence/**` | pure functions | ✅ |
| Sourcing service | `src/arbitrage/sourcing/**` | per-request | ✅ |
| Circuit breaker | `src/arbitrage/reliability/circuit-breaker.ts` | in-process state | ❌ (NOT wired into runtime today) |
| Health/metrics HTTP server | `src/arbitrage/observability/health.ts` | long-lived `http.createServer` on :9090 | ❌ (persistent listener) |
| Metrics registry | `src/arbitrage/observability/metrics.ts` | in-process counters | ⚠️ (resets per serverless invocation) |
| Telegram bot (long polling) | `src/legacy/bot/handlers.ts` → `bot.launch()` | persistent polling loop | ❌ (long polling) |
| Legacy promo engine | `src/legacy/engine/`, `scrapers/` | per-command | ⚠️ (legacy, not the focus) |

### 1.3 Key facts confirmed by reading source

- **No scheduler exists.** `grep` for `setInterval`, `cron`, `node-cron`, `scheduler`, `recurring`, `background worker` across `src/` → only one-shot `setTimeout` (delays, retry backoff, debounce, per-request discovery timeout). There is **no recurring job loop**; the only "always-on" runtime is Telegram `bot.launch()`.
- **No HTTP API beyond health.** The only HTTP server is `startHealthServer()` with 4 routes (`/live`, `/ready`, `/health`, `/metrics`). No `/api/*` surface, no Express.
- **Import isolation (critical).** The arbitrage engine (`src/arbitrage/**`) does **NOT** transitively import `better-sqlite3` or `telegraf`. Only `src/index.ts` and `src/legacy/**` pull those in. This means a serverless API can reuse the engine without dragging the SQLite native binary or the Telegraf polling loop into the bundle.
- **Config coupling.** `base-adapter.ts:42,106` reads `config.maxConcurrentRequests` / `config.ssrfFirewallEnabled`, and `pool.ts:2` uses `dbConfig`. The Zod schema makes `TELEGRAM_BOT_TOKEN` **required** — so importing the engine on Vercel would fail unless the token is present even though the API never uses Telegram. This must be decoupled.
- **DB tests are independent.** `pg-integration.test.ts` builds its own `Pool` from `PG_*` env vars; `db.test.ts` mocks `pg` and asserts on migration SQL text. Neither depends on `pool.ts`'s resolution logic — so evolving the connection model is safe.
- **Circuit breaker is NOT wired.** `CircuitBreaker` is implemented and tested but no production file instantiates it; `circuit_breaker_trips_total` is registered but never incremented. This migration does **not** change that (out of scope; flagged as remaining work).
- **Financial integrity is untouched.** `UNKNOWN ≠ ZERO`, dual-engine, Decimal.js precision 28, Σ probabilities = 1 — none of this is modified by the migration.

---

## 2. Target Architecture (AFTER)

### 2.1 Runtime topology

```
┌──────────────────────────── VERCEL (serverless) ────────────────────────────┐
│                                                                              │
│   /api/health  /api/live  /api/ready  /api/metrics                           │
│   /api/opportunities  /api/suppliers  /api/products  /api/audit              │
│                                                                              │
│   Each route: thin handler → shared engine (src/arbitrage/**) → DB layer    │
│   No Telegram, no SQLite, no long polling, no setInterval.                  │
│                                                                              │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ TLS (serverless-safe pooled PG conn)
                                       ▼
┌──────────────────────────── SUPABASE (PostgreSQL 16) ────────────────────────┐
│  28 tables + schema_migrations, 27 FKs, 98 indexes, NUMERIC(18,4), ENUMs     │
│  Connection via PgBouncer (transaction mode, port 6543) for serverless,      │
│  or direct (port 5432) for the worker. SSL required.                         │
└──────────────────────────────────────▲───────────────────────────────────────┘
                                       │ pooled PG conn (direct)
┌──────────────────────────── WORKER (persistent process) ────────────────────┐
│                                                                              │
│   src/index.ts  →  Telegram bot.launch() (long polling)                      │
│                →  health/metrics server on :9090                             │
│                →  legacy SQLite (user prefs)                                 │
│                →  marketplace adapters (crawlers)                             │
│                →  arbitrage pipeline (invoked by /arbitrage command)         │
│   Future: schedulers/cron jobs (none exist today; hooks ready)             │
│                                                                              │
│   Deployed via Docker (Dockerfile) / VPS / any container host.               │
│   NOT deployed to Vercel.                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component classification

| Component | Target | Rationale |
|---|---|---|
| Web/dashboard/API | **Vercel** | Stateless HTTP, serverless-native |
| Health/live/ready/metrics API | **Vercel** (`/api/*`) + worker (`:9090`) | Both surfaces; Vercel for public probes, worker for internal Prometheus scrape |
| Telegram bot (long polling) | **Worker** | Persistent polling loop — incompatible with serverless |
| Marketplace crawlers/adapters | **Worker** | Rate-limited, retry, circuit-breaker state, long latency |
| Supplier sourcing | **Shared** (worker + API + tests) | Pure orchestration; safe in both |
| Financial/intelligence engines | **Shared** | Pure functions; reused everywhere |
| DB layer | **Shared** (serverless-safe abstraction) | Connection strategy differs per runtime |
| Migrations | **CLI** (`npm run migrate`) | One-shot; run against Supabase |
| Verification | **CLI** (`npm run verify:supabase`) | One-shot runtime check |
| Legacy SQLite (belibot prefs) | **Worker only** | Native binary + filesystem; never on Vercel |

### 2.3 Shared / worker / web separation

The repository keeps a **single source of truth** for business logic. There is no code duplication:

- **`src/arbitrage/**`** — shared engine (financial, intelligence, pipeline, sourcing, db, observability, reliability, lib). Importable by worker, API, and tests.
- **`api/**`** — Vercel serverless functions (NEW). Thin HTTP handlers that import the shared engine. Compiled by a dedicated `tsconfig.api.json`.
- **`src/index.ts`** — worker entrypoint (unchanged runtime model: Telegram + health server + legacy SQLite).
- **`src/arbitrage/db/connection.ts`** — NEW connection resolver that picks Supabase vs local PG and is serverless-aware.

---

## 3. Supabase Integration Strategy

### 3.1 Why Supabase is compatible without a rewrite

Supabase **is** PostgreSQL 16. The existing migration (`0001-core-foundation.sql`) uses only standard PostgreSQL features:

| Feature used | Supabase support | Action needed |
|---|---|---|
| `CREATE TABLE`, `FK`, `INDEX`, `UNIQUE` | ✅ native | none |
| `CREATE TYPE ... AS ENUM` (12 enums) | ✅ native | none |
| `NUMERIC(18,4)` financial columns | ✅ native | none |
| `TIMESTAMPTZ` | ✅ native | none |
| `VARCHAR(26)` ULID PKs | ✅ native | none |
| `JSONB` | ✅ native | none |
| `uuid-ossp` extension | ✅ available | keep `CREATE EXTENSION IF NOT EXISTS` |
| `ON CONFLICT` (idempotent seeds) | ✅ native | none |
| `BEGIN/COMMIT/ROLLBACK` | ✅ native | none |
| `schema_migrations` tracking table | ✅ native | none |
| `CREATE EXTENSION` for `pgcrypto` etc. | ✅ dashboard-allowable | none required by current migration |

**Conclusion:** The SQL migration runs on Supabase unchanged. No Supabase SDK is introduced; the app keeps using `pg` (node-postgres) for all database access.

### 3.2 Connection strategy

Two connection modes, auto-resolved by `src/arbitrage/db/connection.ts`:

1. **`SUPABASE_DATABASE_URL`** (preferred for production/serverless) — a full PostgreSQL URI (e.g. `postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require`). Used when present. The pooler hostname on port **6543** (PgBouncer transaction mode) is the correct target for serverless; port **5432** (direct) is correct for the worker.
2. **`DATABASE_URL`** (preferred for local/alternative) — any standard PostgreSQL URI.
3. **`PG_*` discrete vars** (legacy/local fallback) — `PG_HOST/PORT/USER/PASSWORD/DATABASE/SSL_MODE`. Preserved for the existing Docker/Local PostgreSQL path so no existing workflow breaks.

Resolution order: `SUPABASE_DATABASE_URL` → `DATABASE_URL` → `PG_*` → throw.

**Serverless-safe pooling:**
- On Vercel, the `api/*` handlers use a **per-function pool** (created on cold start, closed in `finally`) OR a **module-level pool with `connectionTimeoutMillis` and `idleTimeoutMillis`** to avoid leaking connections across invocations. The connection resolver exposes a `getPool()` that is safe to call repeatedly; in serverless it is configured with smaller pool sizes (`max: 3`) and short idle timeouts.
- On the worker, `getPool()` returns a long-lived shared `Pool` (`max: 10`) as today.

### 3.3 SSL

- `PG_SSL_MODE` (`disable`/`require`/`verify-full`) is honored for `PG_*` connections.
- For URI-based connections (`SUPABASE_DATABASE_URL`/`DATABASE_URL`), `sslmode` in the query string is respected; if absent, SSL defaults to **`require`** for any non-localhost host (production-safe default).

### 3.4 No client-side Supabase exposure

- The browser/client never talks to Supabase directly. All DB access is server-side (Vercel function or worker).
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are documented for completeness/RLS, but the current app does not use the Supabase JS client. If future browser access is added, RLS must be enabled; that is documented as a decision, not implemented speculatively.
- Service-role key is **never** shipped to the client (enforced by keeping it out of `NEXT_PUBLIC_*`/client bundles; the Vercel API only reads it server-side if ever needed).

---

## 4. Environment Variables

### 4.1 New variables (added)

| Variable | Where used | Required? | Purpose |
|---|---|---|---|
| `SUPABASE_DATABASE_URL` | DB layer, migrate, verify | preferred prod | Supabase PostgreSQL pooled URI |
| `DATABASE_URL` | DB layer (alt) | optional | Any standard PG URI |
| `SUPABASE_URL` | documented | optional | Supabase project URL (future JS client) |
| `SUPABASE_ANON_KEY` | documented | optional | Supabase anon key (future browser/RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side only | optional | Supabase service role (never client) |
| `APPLICATION_ENV` | config | optional | `development`/`test`/`production` |
| `WORKER_MODE` | worker entrypoint | optional | If `true`, worker starts even if SQLite/Telegram partial |
| `PG_POOL_MAX` | DB layer | optional | Max pool size (serverless: small; worker: large) |

### 4.2 Preserved variables (unchanged)

All existing `PG_*`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`, `SSRF_FIREWALL_ENABLED`, `HEALTH_PORT`, `PG_SKIP_OK`, scraper tuning, logging, and fee-related variables remain exactly as-is.

### 4.3 Making TELEGRAM_BOT_TOKEN optional for the API

`TELEGRAM_BOT_TOKEN` is currently **required** by the Zod schema. The Vercel API never uses Telegram. To avoid forcing a token into the API environment:

- The Zod schema keeps `TELEGRAM_BOT_TOKEN` required for the **worker** path (enforced by a worker guard in `src/index.ts`, not by the global schema).
- The shared engine config (`src/config.ts`) makes `TELEGRAM_BOT_TOKEN` **optional** with default `''`; the worker explicitly validates presence at boot and exits 1 if missing. This lets the API import the engine with `TELEGRAM_BOT_TOKEN` unset.

This is a **behavior-preserving** change for the worker (it still fails fast without a token) while unblocking the API.

---

## 5. Database Migration Strategy

- **Forward-only, idempotent, transactional** — unchanged. `migrate.ts` already wraps each file in `BEGIN/COMMIT`, records SHA-256 checksums in `schema_migrations`, and skips applied versions.
- **Connection resolution** — `migrate.ts` is refactored to use the new `connection.ts` resolver so it accepts `SUPABASE_DATABASE_URL` / `DATABASE_URL` / `PG_*` in that order. Existing `PG_*` behavior is preserved.
- **Supabase execution** — run `npm run migrate` with `SUPABASE_DATABASE_URL` set (or `DATABASE_URL`). For serverless safety, the migration uses a **direct connection** (port 5432), not the pooler (port 6543), because DDL over PgBouncer transaction mode can be unreliable. The resolver detects a `pooler` hostname and prefers the direct port for migrations when possible; otherwise it uses the provided URI as-is.
- **Rollback** — not implemented (consistent with the existing report). Documented as forward-only; backup with `pg_dump` before applying. No destructive migration is introduced by this work.
- **Failure** — migration failure exits non-zero (already the case). No silent skipping.

---

## 6. Runtime Verification Strategy (`npm run verify:supabase`)

A new CLI script `src/arbitrage/db/verify-supabase.ts` that, against the resolved DB:

1. DNS/connectivity (TCP reachability via `SELECT 1`)
2. TLS/SSL (verify `sslmode` in effect via `SHOW ssl`)
3. Authentication (successful `SELECT current_user`)
4. `SELECT`
5. `INSERT` (into a dedicated `_supabase_verify` scratch table, created+dropped per run)
6. `UPDATE`
7. `DELETE`
8. Transaction `COMMIT`
9. Transaction `ROLLBACK`
10. Foreign key enforcement (insert child without parent → expects failure)
11. Unique constraint (duplicate insert → expects failure)
12. Concurrent access (two parallel `SELECT ... FOR UPDATE` on the scratch table)
13. Reconnect (close pool, reopen, `SELECT 1`)
14. Persistence (insert, close, reopen, select)
15. Migration state (row count of `schema_migrations`)
16. Schema version (latest applied version)

- Uses a **scratch table** (`_supabase_verify_scratch`) created and dropped within the run — never touches production tables.
- Reads credentials from the same resolver as production.
- Exits 0 on full pass, 1 on any failure. Prints a per-check PASS/SKIP/FAIL table.
- Does **not** run destructive tests against production data.

---

## 7. Failure Injection (Phase 6)

The existing `db-failure-injection.test.ts` already covers invalid credentials, unavailable DB, transaction rollback, constraint violations, pool exhaustion, reconnect, and transient failure. The migration:

- Keeps those tests intact.
- Adds connection-resolver-level failure tests (invalid URI, unreachable host, missing all DB env → throws clearly, no financial decision produced).
- The app already fails safely: the pipeline never writes opportunities if the DB is unreachable (degraded mode), and the decision engine is fail-closed regardless of DB state.

---

## 8. Vercel Architecture

### 8.1 `api/` directory

A new top-level `api/` directory (Vercel's convention for Serverless Functions) contains thin handlers:

```
api/
├── health.ts        # GET /api/health  — aggregate health (no secrets)
├── live.ts          # GET /api/live    — liveness
├── ready.ts         # GET /api/ready    — readiness (PG + adapters)
├── metrics.ts       # GET /api/metrics  — Prometheus text
├── opportunities.ts # GET /api/opportunities — list/read (read-only)
├── suppliers.ts     # GET /api/suppliers     — read-only
├── products.ts      # GET /api/products      — read-only
└── audit.ts         # GET /api/audit         — audit/status (admin-protected)
```

- Each handler is a default-exported `export default function handler(req, res)` (Vercel Node convention).
- Each imports the **shared engine** from `src/arbitrage/**` (compiled via `tsconfig.api.json` that includes `src/`).
- No handler imports `telegraf` or `better-sqlite3`.
- No handler starts a long-lived server or polling loop.
- Admin endpoints (`/api/audit`) require an `ADMIN_API_KEY` header (constant-time compare); without it, 401.

### 8.2 `vercel.json`

Added only because the repo is TypeScript and needs:
- `buildCommand`: `npm run build` (or a dedicated `build:api`).
- `installCommand`: `npm ci`.
- `functions.api/*.ts`: `{ runtime: '@vercel/node', maxDuration: 30 }`.
- No `outputDirectory` (no static frontend today).
- No crons unless a short, idempotent, HTTP-triggerable job is justified (none today).

### 8.3 `tsconfig.api.json`

A dedicated TS config that compiles `api/**/*.ts` + `src/arbitrage/**` (shared) into the Vercel build, excluding `src/legacy/**` and tests. This keeps the serverless bundle lean and avoids the `better-sqlite3` native dependency.

---

## 9. Worker Architecture

The worker is the existing `src/index.ts` process, unchanged in runtime model:

- Telegram `bot.launch()` long polling.
- Health/metrics server on `:9090`.
- Legacy SQLite (user prefs).
- Marketplace adapters (crawlers) invoked by the `/arbitrage` command.
- Arbitrage pipeline.

Deployment: **Docker** (existing `Dockerfile` + `docker-compose.yml`) on a VPS or any container host. The worker is **not** deployed to Vercel. Graceful shutdown, non-root user, health check, and restart policy already exist in the Dockerfile/compose.

### 9.1 Scheduler (future hook)

No scheduler exists today. The architecture reserves a place for one in the worker:

- `setInterval`/`node-cron` jobs (crawl refresh, decay, learning) would live in the worker only — never in Vercel functions.
- Vercel Cron may be used **only** for short, idempotent, HTTP-triggerable jobs (e.g., a `/api/health` ping). None are added speculatively; the plan documents the constraint.

### 9.2 Telegram webhook (alternative, not chosen by default)

The prompt allows either (A) dedicated worker or (B) Telegram webhook. **Choice: (A) dedicated worker** because:
- The bot already runs long polling in production-style and the worker is the natural home.
- A webhook would require a public HTTPS endpoint, Telegram request validation, replay protection, and a background processing mechanism — adding complexity without a current benefit.
- The plan documents the webhook option and its requirements (idempotency, validation, auth) so it can be adopted later without re-architecture.

---

## 10. Security Model

- **Secrets never in client.** Vercel API builds exclude `src/legacy/**`; `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, and supplier/marketplace secrets are server-side env vars configured in Vercel/worker — never `NEXT_PUBLIC_*`.
- **`.gitignore`** already covers `.env*`, `*.db`, `data/`, `coverage/`, `dist/`. Verified; no change needed.
- **SSRF firewall** preserved (`SSRF_FIREWALL_ENABLED=true` default). Vercel API handlers that trigger crawls are **not** added (crawlers stay in the worker).
- **Telegram authorization** (`ALLOWED_USER_IDS`) preserved in the worker; unchanged.
- **Admin API** (`/api/audit`) gated by `ADMIN_API_KEY` header.
- **RLS decision:** not enabled now (no browser→Supabase path). Documented as a decision; if a dashboard with direct browser DB access is added later, RLS must be turned on. Service-role key stays server-side.
- **No secret in logs/metrics** — preserved (logger redaction, health/metrics audited for secret leakage in existing tests).

---

## 11. Local Development Model

Two supported paths:

**Option A — Supabase cloud (preferred, documented as primary):**
1. Create a Supabase project (supabase.com).
2. Get the connection string (Settings → Database → Connection string → URI).
3. Copy `.env.example` → `.env.local`; set `SUPABASE_DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_USER_IDS`.
4. `npm run migrate` (applies schema to Supabase).
5. `npm run verify:supabase` (runtime check).
6. `npm test` (unit/intelligence; PG integration tests run against Supabase if `PG_SKIP_OK=false` and a DB env is set).
7. `npm run dev` (worker) and/or `vercel dev` (API).

**Option B — Local PostgreSQL/Docker (fallback, preserved):**
1. `docker compose up -d postgres` (uses existing `docker-compose.yml`, PG 16 on :5433).
2. Set `PG_*` in `.env`.
3. `npm run migrate` → `npm test` → `npm run dev`.

Both paths use the **same** `connection.ts` resolver.

---

## 12. Test Strategy

- **Existing 511 tests + 32 suites preserved.** No test is weakened or removed.
- **Config tests** updated to cover optional `TELEGRAM_BOT_TOKEN`, `SUPABASE_DATABASE_URL`, and `DATABASE_URL` resolution.
- **Connection tests** added: resolution order, URI parsing, SSL defaults, serverless-vs-worker pool sizing, failure on missing all DB env.
- **verify-supabase** has its own self-test (runs against a throwaway scratch schema; skipped if no DB env, with `PG_SKIP_OK` semantics).
- **API route tests** added: boot, health, auth, DB-unavailable, timeout, secret leakage.
- **`PG_SKIP_OK`** behavior preserved: local dev may skip PG integration tests; CI sets `PG_SKIP_OK=false` so DB tests **fail** (not silently pass) if the DB is unreachable. The new Supabase tests follow the same convention.

---

## 13. CI/CD

`.github/workflows/ci.yml` is updated:
- Keep the PostgreSQL 16 service container (local PG path still tested).
- Add a Supabase-compatible DB test step that runs `npm run verify:supabase` when `SUPABASE_DATABASE_URL` is present (separate job, secrets-driven; does not fail the matrix if the secret is absent — it is `NOT_TESTED` in public CI).
- Keep typecheck, lint, build, test, coverage, secret scan, dependency audit.
- Add `typecheck:api` and `build:api` steps for the Vercel API layer.
- Keep `PG_SKIP_OK=false` in the PG service job (tests fail if PG down — no silent PASS).

---

## 14. Rollback Strategy

- **Code rollback:** `git checkout <previous-tag>` → rebuild → redeploy. No migration is required to roll back code.
- **DB rollback:** forward-only (no down-migrations). Before any production migration, take a `pg_dump` backup. To revert schema, restore from the pre-migration backup. No destructive migration is introduced by this work.
- **Vercel rollback:** Vercel keeps instant rollbacks to previous deployments.
- **Worker rollback:** redeploy the previous Docker image; the existing `docker-compose.yml` supports image tagging.

---

## 15. Deployment Model Summary

| Surface | Platform | Trigger | Notes |
|---|---|---|---|
| API/web | Vercel | git push → auto | `vercel.json`, `api/` functions |
| Worker (Telegram + crawlers + future scheduler) | Docker/VPS or container host | manual/CI image build | `Dockerfile`, `docker-compose.yml` |
| Database | Supabase | `npm run migrate` (CLI) | PostgreSQL 16, pooled for serverless |
| Verification | CLI | `npm run verify:supabase` | runtime check before deploy |
| CI/CD | GitHub Actions | push/PR | typecheck, lint, build, test, coverage, secret scan |

---

## 16. What This Migration Does NOT Do

- Does **not** rewrite the application.
- Does **not** replace `pg` with the Supabase JS client.
- Does **not** introduce the Supabase SDK into the engine.
- Does **not** move Telegram polling or crawlers to Vercel.
- Does **not** remove Docker/local PostgreSQL support.
- Does **not** weaken any test or skip any integration test silently.
- Does **not** alter financial formulas, decision gates C01–C15, circuit breaker behavior, observability, or data lineage.
- Does **not** fabricate credentials, deployment results, or supplier/marketplace data.

---

## 17. Production Gate

Per the audit, the gate remains **NOT_READY** until real supplier/marketplace credentials are obtained and a real end-to-end arbitrage is verified. This migration improves **deployment readiness** and **database cloud-ability** but does not itself close the P1 business-verification items (real supplier API, real marketplace HTTP, real data). Any final report will state this honestly.
