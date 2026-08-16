# PHASE 17.1 — Production Baseline Snapshot

**Phase:** 17.1 (inspection only — no code modified)
**Date:** 2026-08-16
**Engineer:** Kilo (evidence-driven)
**Mode:** EVIDENCE-DRIVEN · FAIL-CLOSED · NO-FABRICATION

---

## 1. Repository State

| Item | Value |
|---|---|
| Branch | `main` |
| Latest commit | `adfd6cb` — "Phase 16.19: Final Vercel production deployment evidence report" |
| Working tree | clean (no uncommitted changes) |
| Version | `2.0.0` (`package.json`) |
| Total commits | 4 (Phase 16 series) |
| Is git repo | yes |

Commit history:
```
adfd6cb Phase 16.19: Final Vercel production deployment evidence report
5d1a960 Phase 16: Update README to reflect deployed + verified production state
edf2715 Phase 16: Vercel production deployment configuration
20dc9a2 Initial commit: MarketIntele Arbitrage Intelligence Engine v2.0.0
```

---

## 2. Runtime / Toolchain

| Item | Value |
|---|---|
| Local Node | `v22.23.2` |
| Local npm | `12.0.2` |
| `engines.node` (package.json) | `>=20.0.0` |
| Platform | win32 (Windows x64) |
| TypeScript | `^5.3.3` |
| Jest | `^30.4.2` (ts-jest `^29.4.12`) |
| Default shell | PowerShell 5.1 |

---

## 3. Production Deployment Topology

| Component | Value | Evidence |
|---|---|---|
| Production URL | `https://marketintele.vercel.app` | Phase 16 report |
| Vercel project | `marketintele` (projectId `prj_pOOfea3vEEelQy6CghoNFHI8mzdA`) | `.vercel/project.json` |
| `vercel.json` regions | **none set** (Vercel default region) | `vercel.json` has no `regions` key |
| Supabase host | `aws-0-ap-northeast-1.pooler.supabase.com` | `.env` SUPABASE_DATABASE_URL parsed |
| Supabase port | `6543` (Transaction Pooler / PgBouncer) | URL parse |
| Supabase region | `ap-northeast-1` (Tokyo) | hostname token |
| SSL | active (resolver defaults non-localhost → `require`) | `connection.ts` sslConfigFromMode |
| `sslmode` in URL | null → resolver applies `require` (rejectUnauthorized:false) | connection resolver |

**Region gap identified:** `vercel.json` declares no `regions` array, so Vercel serverless functions execute in the **default region** (historically `iad1` / Washington D.C. for projects without an explicit region). Supabase is in Tokyo (`ap-northeast-1`). This is a cross-region latency mismatch analyzed in Phase 17.2.

---

## 4. Current Architecture (verified)

### 4.1 Two distinct runtimes

The codebase ships **two** execution targets that share the engine but NOT the entrypoint:

| Runtime | Entrypoint | DB | Telegram | SQLite | Deploy |
|---|---|---|---|---|---|
| **Serverless API** (Vercel) | `api/*.ts` (8 routes) | PostgreSQL/Supabase pool (short-lived) | NO | NO | Live on Vercel |
| **Worker** (persistent) | `src/index.ts` | PostgreSQL + **better-sqlite3** | YES (Telegraf) | YES | Local / self-hosted (NOT Vercel) |

The serverless API is **import-safe**: `api/_lib/http.ts` imports only `pg`, the connection resolver, adapters, and observability — it explicitly avoids `telegraf` and `better-sqlite3`. This keeps SQLite out of the serverless bundle (verified by comment + import graph).

### 4.2 Configuration (`src/config.ts`)

- Single Zod schema validates all env vars at import time.
- `TELEGRAM_BOT_TOKEN` is **optional** in the schema (so the API can import the engine); the worker enforces it via `requireWorkerConfig()`.
- DB resolution order: `SUPABASE_DATABASE_URL` → `DATABASE_URL` → `PG_*` discrete → throw `DbConfigError` (never silently default).
- SSRF firewall **on** by default (`SSRF_FIREWALL_ENABLED=true`).
- `WORKER_MODE` flag separates worker from API.

### 4.3 Database connection resolver (`src/arbitrage/db/connection.ts`)

- `resolveDbConfig()` — central, environment-driven, fail-closed.
- `parsePgUri()` — parses `postgresql://` URIs, preserves `sslmode`.
- Supabase pooler detected by `port === 6543`.
- SSL: `disable`/`require`/`verify-full` + safe default (`require` for non-localhost).
- `poolDefaultsForServerless()` (max 3, 10s idle) vs `poolDefaultsForWorker()` (max 10, 30s idle).
- `createPool()` honors explicit `PG_POOL_MAX` override.

### 4.4 Database pool (`src/arbitrage/db/pool.ts`)

- `getPool()` — lazily-initialized shared pool (worker).
- `createServerlessPool()` — short-lived pool for a single invocation; caller closes in `finally` (used by API via `withServerlessDb`).
- `withTransaction()` — BEGIN/COMMIT/ROLLBACK.
- `healthCheck()` — `SELECT 1 AS alive`.
- `closePool()` — idempotent teardown.

### 4.5 Schema (`src/arbitrage/db/migrations/0001-core-foundation.sql`)

Single migration creating **28 tables** across 5 groups:

1. **Ingestion & Raw:** `sources`, `source_health`, `crawl_jobs`, `crawl_events`, `raw_documents`, `raw_products`
2. **Core Entities:** `suppliers`, `supplier_contacts`, `supplier_products`, `supplier_prices`, `products`, `product_variants`, `product_matches`
3. **Marketplace & Intel:** `marketplaces`, `marketplace_listings`, `marketplace_prices`, `demand_signals`, `competition_snapshots`
4. **Economics & Decisions:** `cost_models`, `profit_models`, `sensitivity_models`, `opportunities`, `opportunity_scores`, `test_orders`
5. **Learning & Audit:** `sales_actuals`, `profit_attribution`, `model_calibrations`, `audit_logs`, `schema_migrations`

Financial columns: `NUMERIC(18,4)`. PKs: `VARCHAR(26)` (ULID). Timestamps: `TIMESTAMPTZ`. 5 marketplace seed rows. Full FK + index coverage.

### 4.6 Adapter registry (`src/arbitrage/adapters/registry.ts`)

`registerDefaults()` registers 5 marketplace adapters at worker bootstrap:
- `ShopeeAdapter` → `shopee`
- `TokopediaAdapter` → `tokopedia`
- `LazadaAdapter` → `lazada`
- `BlibliAdapter` → `blibli`
- `TikTokShopAdapter` → `tiktok_shop`

All extend `BaseSourceAdapter` (SSRF firewall, rate limiting, redirect-safe fetching, content hashing).

### 4.7 Marketplace adapters (`src/arbitrage/adapters/*.ts`)

Each adapter implements `SourceAdapter`: `search` / `fetch` / `parse` / `normalize` / optional `healthCheck`.
- **No credentials required** — they target public web endpoints (search pages / public APIs) with browser-like headers.
- **No fabricated data** — empty results on failure (return `[]` / empty entities), never synthetic listings.
- Provenance: `dataLineage` with `evidenceHierarchyLevel` + `rawEvidenceHash`.
- Example: `ShopeeAdapter` uses `https://shopee.co.id/api/v2/search_items/`, parses JSON/HTML, price in micro-units (/100000).

### 4.8 Supplier abstraction (`src/arbitrage/sourcing/supplier-adapter.ts`)

- `SupplierSourceEntity` — canonical supplier identity (FACTORY/MANUFACTURER/DISTRIBUTOR/...).
- `SupplierPricing` — `unitPriceIdr: number | null` (**null = UNKNOWN, never 0**), MOQ, price tiers, lead time, stock.
- `SupplierAdapter` interface — `searchSuppliers()` / `verifySupplier()`.
- `SupplierOffer` — supplier + pricing + match confidence.
- `offerToSupplierSource()` preserves the UNKNOWN invariant (null prices stay null).
- **Data provenance field:** `'REAL' | 'TEST_FIXTURE' | 'MOCK' | 'SIMULATION'`.

### 4.9 Supplier sourcing service (`src/arbitrage/sourcing/supplier-sourcing-service.ts`)

- Orchestrates registered `SupplierAdapter`s.
- **Fail-closed:** when no adapter registered → returns `supplier: null`, `dataProvenance: 'NONE'`. **Never invents a supplier.**
- `hasRealAdapters()` distinguishes REAL vs TEST_FIXTURE.
- Best offer selected by `matchConfidence`.

### 4.10 Test-fixture supplier adapter (`src/arbitrage/sourcing/test-fixture-supplier-adapter.ts`)

- **Explicitly labelled `TEST_FIXTURE`** provenance — never masquerades as real.
- For deterministic pipeline vertical-slice tests only.

### 4.11 Pipeline (`src/arbitrage/pipeline/pipeline.ts`)

`ArbitragePipeline.execute()` runs the full end-to-end flow:
1. **Discovery** → marketplace adapter search
2. **Market Clearing Price** (P25 conservative, multi-listing aggregation)
3. **Matching** (identity/self-match until supplier DB exists)
4. **Supplier Resolution** (real adapter → marketplace-seller derivation fallback, fail-closed)
5. **Economics** (landed cost + marketplace fees + profit, dual-engine)
6. **Demand / Competition / Decay / Expected Value** intelligence stages
7. **Risk Assessment** + Comprehensive 11-dimension risk
8. **Opportunity Decision** (15 gates C01–C15)

### 4.12 Economic engine (`src/arbitrage/pipeline/economics.ts` + `src/arbitrage/economic/*`)

- **Decimal engine** (`decimal-engine.ts`): precision=28, ROUND_HALF_EVEN, IEEE-754 floats banned, throws on NaN/Infinity.
- **UNKNOWN != 0 invariant** (`profit-engine.ts`): `computeLandedCost()` throws `UncalculatedCostException` when any required component is null. Supplier base cost null → landed cost null → profit blocked.
- **Dual-engine validation** (`calculateProfitWithValidation()`): Engine A computes; Engine B independently reconstructs from raw components (genuine independence, not algebraic rearrangement). Reconciliation within 1 IDR tolerance.
- **Marketplace fees** (`economics.ts getFeeConfigForMarketplace`): confirmed fee schedules for all 5 marketplaces (commission, transaction, payment, return provision) with `evidence` provenance + version. `FeeConfigurationIncompleteError` on missing config.
- **Sensitivity matrix** (5×5 price/cost shifts) → robustness rating (VERY_FRAGILE→VERY_ROBUST).
- **Scenarios**: BEAR/BASE/BULL with conservative modifiers.

### 4.13 Decision engine (`src/arbitrage/pipeline/decision.ts`)

15 validation gates:
- **Critical (12):** C01 Product Identity, C02 Supplier Identity, C03 Unit/Package, C04 Price+MOQ, C05 Comparability, C06 Market Clearing Price (≥MEDIUM confidence), C07 Landed Cost Complete, C08 Fees Configured, C09 Independent Profit Match, C12 Risk Within Bounds, C13 Freshness, C14 Sensitivity Robustness (≥MODERATE), C15 Confidence Floor.
- **Non-critical (2):** C10 Demand, C11 Competition.
- Any critical gate fail → `REJECT`. All critical pass + warnings → `REVIEW`. All pass → `RECOMMEND`.
- Quality tier: S/A/B/C based on ROI + margin.

### 4.14 Worker entrypoint (`src/index.ts`)

Bootstrap sequence:
1. `requireWorkerConfig()` — throws if no `TELEGRAM_BOT_TOKEN`.
2. **`initDb(config.databasePath)` — better-sqlite3** (user prefs, promo history). Exits 1 on failure.
3. PostgreSQL health check (degraded mode if unreachable, does not exit).
4. Fee config validation.
5. `registerDefaults()` — 5 marketplace adapters.
6. `startHealthServer(9090)` — `/live`, `/ready`, `/health`, `/metrics`.
7. `createBot(pipeline).launch()` — Telegraf polling.
8. Graceful shutdown: stop health server → closePool → bot.stop → adapterRegistry.shutdownAll.

### 4.15 Legacy SQLite (`src/legacy/database/index.ts`)

3 tables: `users` (telegram prefs), `promos`, `promo_history`. WAL mode. Used **only by the worker** (bot handlers call `initDb`, `upsertUser`, `getUser`, `insertPromoHistory`, `getPromoHistory`). **Not imported by any API route.**

### 4.16 API routes (`api/*.ts`) — 8 routes, all live on Vercel

| Route | Auth | DB | Purpose |
|---|---|---|---|
| `GET /api/live` | none | no | liveness |
| `GET /api/ready` | none | yes (health) | readiness |
| `GET /api/health` | none | yes (health) | aggregate health |
| `GET /api/metrics` | none | no | metrics registry |
| `GET /api/opportunities` | none | yes (read) | persisted opportunities (provenance `REAL`) |
| `GET /api/suppliers` | none | yes (read) | suppliers |
| `GET /api/products` | none | yes (read) | products |
| `GET /api/audit` | **`x-admin-api-key`** | yes | schema version + row counts |

Admin guard: constant-time compare; missing `ADMIN_API_KEY` → 503; wrong key → 401. All routes use `withServerlessDb()` (short-lived pool, closed in `finally`). `vercel.json` sets `installCommand: npm ci --ignore-scripts` (native build scripts skipped) and `buildCommand: echo build skipped` (prebuilt `dist-api`).

---

## 5. Verified Production Components (Phase 16 carry-over)

| Verification | Status |
|---|---|
| 545/545 tests PASS | ✅ (Phase 16) |
| build PASS | ✅ |
| typecheck PASS | ✅ |
| lint PASS | ✅ |
| Supabase verification 16/16 PASS | ✅ |
| schema audit 8/8 PASS | ✅ |
| migrations PASS | ✅ |
| 8 production API routes validated | ✅ |
| authentication/authorization PASS | ✅ |
| serverless bundle safety PASS (no SQLite in bundle) | ✅ |
| secret hygiene PASS | ✅ |
| Production deployment LIVE | ✅ `https://marketintele.vercel.app` |

*(Re-validated live in Phase 17.10.)*

---

## 6. Known Blockers (carried from Phase 16)

| # | Blocker | Root cause | Impact |
|---|---|---|---|
| 1 | Telegram worker blocked by `better-sqlite3` native binding under Node 22/24 | Native compilation / prebuilt binary availability | Worker cannot boot on some Node 22/24 + platform combos |
| 2 | No real supplier/B2B credentials | No Alibaba / B2B directory API keys | Supplier cost stays UNKNOWN → arbitrage correctly fails closed |
| 3 | No real marketplace credentials/data ingestion credentials | Adapters use public endpoints only (no official API auth) | Limited reliability / rate limits |
| 4 | Arbitrage engine correctly fails closed when supplier cost is UNKNOWN | By design (UNKNOWN != 0) | Empty opportunity results — **NOT an error** |

**Note:** Empty opportunity results are **expected** because no real supplier data has been ingested. This is the fail-closed design working correctly, not a defect.

---

## 7. Known Architectural Gaps

| # | Gap | Evidence |
|---|---|---|
| G1 | No explicit Vercel region configured | `vercel.json` has no `regions` array → default region (likely `iad1`) vs Supabase Tokyo |
| G2 | `better-sqlite3@9.6.0` native binding fragility | `package.json` pins `^9.6.0`; loads OK on this machine (prebuilt binary present) but fails on others |
| G3 | No real supplier adapter registered | `supplierSourcingService` has 0 adapters → returns null (fail-closed by design) |
| G4 | Marketplace adapters use public scraping, not official APIs | No credentials → rate-limit / blocking risk; no guaranteed data contracts |
| G5 | `.env` uses `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` while config schema expects `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` | naming mismatch (Supabase JS client not used today, so no runtime impact, but documented) |
| G6 | Worker SQLite state not replicated to PostgreSQL | `users`/`promos`/`promo_history` live only in local SQLite |

---

## 8. Files Responsible for Each Subsystem

| Subsystem | Primary file(s) |
|---|---|
| Worker entrypoint | `src/index.ts` |
| Config / env validation | `src/config.ts` |
| DB connection resolver | `src/arbitrage/db/connection.ts` |
| DB pool (worker + serverless) | `src/arbitrage/db/pool.ts` |
| Migrations | `src/arbitrage/db/migrations/0001-core-foundation.sql` |
| Migration runner | `src/arbitrage/db/migrate.ts` |
| Supabase verifier | `src/arbitrage/db/verify-supabase.ts` |
| Schema audit | `scripts/schema-audit.ts` |
| Adapter registry | `src/arbitrage/adapters/registry.ts` |
| Base adapter (SSRF/retry/throttle) | `src/arbitrage/adapters/base-adapter.ts` |
| Marketplace adapters | `src/arbitrage/adapters/{shopee,tokopedia,lazada,blibli,tiktokshop}-adapter.ts` |
| Supplier adapter interface | `src/arbitrage/sourcing/supplier-adapter.ts` |
| Supplier sourcing service | `src/arbitrage/sourcing/supplier-sourcing-service.ts` |
| Test-fixture supplier | `src/arbitrage/sourcing/test-fixture-supplier-adapter.ts` |
| Supplier resolver (fallback) | `src/arbitrage/pipeline/supplier.ts` |
| Pipeline orchestrator | `src/arbitrage/pipeline/pipeline.ts` |
| Discovery | `src/arbitrage/pipeline/discovery.ts` |
| Matching | `src/arbitrage/pipeline/matching.ts` |
| Economics | `src/arbitrage/pipeline/economics.ts` |
| Profit engine (dual-engine) | `src/arbitrage/economic/profit-engine.ts` |
| Decimal engine | `src/arbitrage/economic/decimal-engine.ts` |
| Fee config | `src/arbitrage/economic/fee-config.ts` |
| Landed cost config | `src/arbitrage/economic/landed-cost-config.ts` |
| Risk | `src/arbitrage/pipeline/risk.ts` |
| Decision (15 gates) | `src/arbitrage/pipeline/decision.ts` |
| Intelligence (demand/competition/decay/EV) | `src/arbitrage/intelligence/*` |
| Observability (health/metrics) | `src/arbitrage/observability/*` |
| Shared types | `src/arbitrage/types.ts`, `src/arbitrage/pipeline/types.ts` |
| Legacy SQLite DB | `src/legacy/database/index.ts` |
| Telegram bot handlers | `src/legacy/bot/handlers.ts` |
| API shared lib | `api/_lib/http.ts` |
| API routes (8) | `api/{live,ready,health,metrics,opportunities,suppliers,products,audit}.ts` |
| Vercel config | `vercel.json` |
| Package config | `package.json`, `package-lock.json`, `tsconfig*.json`, `.eslintrc.json` |

---

## 9. Baseline Conclusion

The system is at **PRODUCTION_INFRASTRUCTURE_READY**:
- The Vercel serverless API is live and verified, with a clean import boundary that excludes SQLite/Telegram.
- The data plane (arbitrage engine, financial integrity, fail-closed supplier/economics/decision gates) is architecturally complete and enforces every safety invariant.
- The remaining blockers are **external dependency** blockers (supplier credentials, marketplace API credentials, worker native binding) — not internal correctness defects.
- Empty opportunity results are the **correct** fail-closed behavior in the absence of real supplier data.

Phase 17 proceeds to analyze region alignment (17.2), worker SQLite dependency (17.3–17.4), and the supplier/marketplace credential boundary (17.5–17.7) **without destabilizing the live deployment**.
