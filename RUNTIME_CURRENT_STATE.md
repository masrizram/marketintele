# RUNTIME CURRENT STATE

**Project:** MarketIntele Arbitrage Intelligence Engine v2.0.0
**Path:** `C:\laraenv\www\marketintele`
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN / FAIL-CLOSED / NO-FABRICATION

---

## A. Database connection resolution order

Resolved by `src/arbitrage/db/connection.ts:resolveDbConfig()` (first non-empty wins):

1. `SUPABASE_DATABASE_URL` — preferred for production / serverless (pooler port 6543)
2. `DATABASE_URL` — generic PostgreSQL URI
3. `PG_*` discrete vars — local Docker/PostgreSQL fallback
4. `throw DbConfigError` — never silently invents credentials

**Currently resolved to:** `supabase:aws-0-ap-northeast-1.pooler.supabase.com:6543` (Transaction Pooler, Tokyo region). `isSupabasePooler=true`, `sslRequired=true`, `config.ssl={rejectUnauthorized:false}`.

## B. Environment variables actually consumed

From `src/config.ts` (Zod schema):
- `APPLICATION_ENV`, `TELEGRAM_BOT_TOKEN`, `WORKER_MODE`
- `SUPABASE_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`, `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`, `PG_SSL_MODE`, `PG_POOL_MAX`
- `DATABASE_PATH` (legacy SQLite), `REDIS_URL` (declared, **unused** in source)
- `SCRAPER_*`, `MAX_CONCURRENT_REQUESTS`
- `LOG_LEVEL`, `MAX_SEARCH_RESULTS`, `NOTIFICATION_CHECK_INTERVAL_SEC`, `ALLOWED_USER_IDS`
- `SSRF_FIREWALL_ENABLED`
- `ADMIN_API_KEY` — consumed in `api/_lib/http.ts:requireAdmin` (NOT in config.ts schema; read directly from `process.env`)
- `PG_SKIP_OK` — consumed in `verify-supabase.ts` and DB integration test gates (NOT in config.ts)

## C. Vercel entrypoints

`vercel.json` → 8 routes, each `api/*.ts` → `@vercel/node`, maxDuration 30, memory 512.
Build command: `npm run build:api` → `tsc -p tsconfig.api.json` → `dist-api/`.

Routes: `/api/health`, `/api/live`, `/api/ready`, `/api/metrics`, `/api/opportunities`, `/api/suppliers`, `/api/products`, `/api/audit`.

## D. Migration command

`npm run migrate` → `tsx src/arbitrage/db/migrate.ts`. Transactional (BEGIN/COMMIT/ROLLBACK), idempotent (`schema_migrations` tracking), SHA-256 checksum per file. Warns when running DDL over a pooler.

## E. DB verification command

`npm run verify:supabase` → `tsx src/arbitrage/db/verify-supabase.ts` (16 checks: connectivity, auth, TLS, CRUD, transactions, FK, unique, concurrency, persistence, reconnect, migration state, schema version).
`npm run schema:audit` → `tsx scripts/schema-audit.ts` (8 schema-integrity checks).

## F. Worker startup command

`npm run dev` / `npm start` → `src/index.ts:bootstrap()`. Requires `TELEGRAM_BOT_TOKEN` (via `requireWorkerConfig`) + legacy SQLite (`initDb`) + PostgreSQL health check + fee config + adapter registration + Telegram bot launch + health server on port 9090.

## G. API routes

8 routes (see C). `/audit` is admin-protected (`x-admin-api-key` header, constant-time compare). All DB-backed reads use `withServerlessDb` (short-lived pool, closed in finally).

## H. Localhost PostgreSQL assumption

**None in the API/DB-resolver path.** `connection.ts` resolves from env (Supabase pooler). The `pg-integration.test.ts` and `db-failure-injection.test.ts` previously hard-coded `PG_*` localhost; **now refactored** to use `resolveDbConfig()` so they hit the configured DB. Negative tests (wrong port) intentionally override.

## I. SQLite in the API path

**None.** `dist-api/api/*.js` contains zero actual `require`/`import` of `better-sqlite3`, `telegraf`, `createBot`, `initDb`, or `legacy/database`. SQLite is only used by the worker (`src/index.ts` → `src/legacy/database`).

## J. Redis requirement

**Not required.** `REDIS_URL` is declared in the config schema but NOT used anywhere in source (only comments/tests). No redis client in `package.json`. Not a runtime dependency.

---

## Toolchain

| Tool | Version |
|---|---|
| Node | v22.23.2 |
| npm | 12.0.2 |
| Git | not a git repository (no `.git`) |
| Docker | **NOT installed** |
| Vercel CLI | **NOT installed** |

## Status

```
CODE          = PASS
DATABASE      = PASS (live Supabase pooler, ap-northeast-1, IPv4)
WORKER_LOCAL  = BLOCKED (better-sqlite3 native binding missing for Node 22/win-x64; no Docker; no Python toolchain)
VERCEL_DEPLOY = NOT_DEPLOYED (CLI unavailable; build green, ready to deploy)
```
