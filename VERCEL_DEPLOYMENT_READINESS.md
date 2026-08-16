# VERCEL DEPLOYMENT READINESS

**Project:** MarketIntele Arbitrage Intelligence Engine v2.0.0
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN / FAIL-CLOSED / NO-FABRICATION

---

## 1. Deployment status

```
VERCEL = NOT_DEPLOYED (Vercel CLI not installed in this environment)
```

The Vercel CLI is not available on this machine, and no Vercel project is linked. Per the fail-closed policy, **no deployment was fabricated**. The infrastructure is READY to deploy; the user must run the deploy with their Vercel account.

## 2. Pre-deployment gates (all PASS)

| Gate | Status | Evidence |
|---|---|---|
| DB_CONNECTION | PASS | `npm run verify:supabase` → 16/16 PASS |
| DB_MIGRATION | PASS | `npm run migrate` exit 0; `npm run schema:audit` → 8/8 PASS |
| DB_INTEGRATION | PASS | 62 DB tests PASS against live DB (0 skipped) |
| BUILD (api) | PASS | `npm run build:api` exit 0 → `dist-api/` |
| BUILD (main) | PASS | `npm run build` exit 0 → `dist/` |
| TYPECHECK | PASS | `tsc --noEmit` and `tsc -p tsconfig.api.json --noEmit` exit 0 |
| LINT | PASS | `eslint` exit 0 |
| SECURITY | PASS | 75 security tests PASS (SSRF, auth, redaction) |
| FINANCIAL | PASS | 139 financial tests PASS (fail-closed verified) |
| TESTING | PASS | 545 tests / 34 suites PASS |
| COVERAGE | PASS | 85.92% stmt / 73.18% branch / 83.21% func / 86.76% line (thresholds met) |

## 3. vercel.json

Valid. `installCommand: npm ci`, `buildCommand: npm run build:api`, 8 routes via `@vercel/node`, maxDuration 30, memory 512.

## 4. Serverless bundle safety (Phase 15)

`dist-api/api/*.js` scanned for actual `require`/`import` of worker-only modules:

| Module | Actual import in dist-api? |
|---|---|
| `better-sqlite3` | **NO** (only a docstring comment mentioning it) |
| `telegraf` | **NO** (only a docstring comment) |
| `createBot` | **NO** |
| `initDb` | **NO** |
| `legacy/database` | **NO** |

**VERCEL_SERVERLESS_DB_SAFETY = PASS:**
- Pool created safely via `withServerlessDb` (short-lived, `max:3`, idle 10s, connect 8s)
- Pool closed in `finally` block (no connection leaks across invocations)
- No persistent timers / filesystem writes / SQLite / Telegram worker startup in the API layer
- No runaway connection creation

## 5. Required Vercel environment variables

Set these in the Vercel project (Project Settings → Environment Variables). **DO NOT upload `.env` to Vercel.**

| Variable | Value / Guidance | Exposure |
|---|---|---|
| `SUPABASE_DATABASE_URL` | `postgresql://postgres.qlldynvgdimalkpuntxe:***@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true` | server-only (never client) |
| `ADMIN_API_KEY` | 64-char hex (generated; see .env) | server-only |
| `SSRF_FIREWALL_ENABLED` | `true` | server |
| `APPLICATION_ENV` | `production` | server |
| `NODE_ENV` | `production` | server |
| `WORKER_MODE` | `false` | server |

**Optional (not read by current code but documented):** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (client-safe only if RLS permits), `SUPABASE_SECRET_KEY` (server-only, if used later).

## 6. Secrets that MUST NOT reach client-side code

- `SUPABASE_SECRET_KEY` — server only
- database password (inside `SUPABASE_DATABASE_URL`) — server only
- `TELEGRAM_BOT_TOKEN` — server only (worker; NOT needed for Vercel API)
- `ADMIN_API_KEY` — server only

Verified: `dist-api/api/*.js` contains no hardcoded secrets; secrets are read from `process.env` at runtime.

## 7. Exact deploy command (for the user)

```bash
# 1. Install Vercel CLI (if not present)
npm i -g vercel

# 2. Link the project (first time)
vercel link

# 3. Set environment variables in Vercel (Project Settings → Environment Variables)
#    Use the table in section 5. Set SUPABASE_DATABASE_URL to the pooler URL with the real password.

# 4. Deploy
vercel --prod

# 5. Post-deploy smoke test (Phase 14): hit the production URL endpoints
#    GET /api/live, /api/ready, /api/health, /api/metrics, /api/opportunities,
#    /api/suppliers, /api/products, /api/audit (with x-admin-api-key header)
```

## 8. Known runtime behavior on Vercel

- `/api/ready` will return **503** until at least one supplier adapter is registered (fail-closed, honest). This is expected for infrastructure-only deployment.
- `/api/health` returns **200** with `status:"degraded"` (same adapter gap).
- DB-backed reads (`/opportunities`, `/suppliers`, `/products`) return **200** with `data:[]` until data is ingested.
- `/api/audit` returns **401** without a valid `x-admin-api-key`, **200** with the correct key.

## 9. Final state

```
VERCEL_BUILD          = PASS
VERCEL_BUNDLE_SAFETY  = PASS
VERCEL_DEPLOY         = NOT_DEPLOYED (CLI unavailable; user must deploy)
VERCEL_RUNTIME        = READY (build green, env documented, bundle clean)
```

## 10. Remaining risk

- Cold-start latency over the cross-region pooler (ap-northeast-1) from Vercel's default region may add ~600-1300ms to DB-backed reads. If Vercel functions run in a region far from Tokyo, consider setting the Vercel function region to match (e.g., `hnd1` / Tokyo) to reduce DB round-trip latency.
- `pgbouncer=true` transaction mode: prepared statements are unsupported. The code does not use prepared statements across the pool boundary (it uses parameterized queries on a single client per invocation), so this is safe.
