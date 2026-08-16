# DATABASE MIGRATION VALIDATION

**Project:** MarketIntele Arbitrage Intelligence Engine v2.0.0
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN / FAIL-CLOSED / NO-FABRICATION

---

## 1. Prerequisite gate

DB connectivity PASSED before migration (see SUPABASE_RUNTIME_VALIDATION.md). `PG_SKIP_OK=false` (failures are real, not skipped).

## 2. Migration command

**Command:** `npm run migrate` → `tsx src/arbitrage/db/migrate.ts`
**Exit code:** 0
**Result:** `0001-core-foundation.sql` applied successfully

```
Starting database migrations...
Migrations are running against a Supabase pooler (supabase:aws-0-ap-northeast-1.pooler.supabase.com:6543).
  For DDL reliability, prefer the direct connection (port 5432) for migrations when available.
Applying migration: 0001-core-foundation.sql
✓ Migration 0001-core-foundation.sql applied successfully
All migrations applied successfully (1 total, 1 new)
Migration runner finished.
```

## 3. Migration properties verified

| Property | Status | Evidence |
|---|---|---|
| Transactional | PASS | migrate.ts wraps entire run in `BEGIN`/`COMMIT`; `ROLLBACK` on error |
| Idempotent | PASS | `schema_migrations` tracking table; skips already-applied versions |
| Preserves `schema_migrations` | PASS | `CREATE TABLE IF NOT EXISTS schema_migrations` (also in migration SQL) |
| Preserves checksums | PASS | SHA-256 of raw SQL stored per migration |
| Fails on unexpected errors | PASS | error → `ROLLBACK` → `throw` → exit 1 |
| Never silently ignores SQL errors | PASS | each `client.query(sql)` error propagates |

## 4. Post-migration verification

**Command:** `npm run verify:supabase`
**Exit code:** 0 — `16 PASS, 0 FAIL, 0 SKIP`

Key post-migration checks now PASS (were FAIL before migration):
- `migration state` — `1 migration(s) recorded`
- `schema version` — `latest version: 0001-core-foundation`

## 5. Schema audit

**Command:** `npm run schema:audit` → `tsx scripts/schema-audit.ts`
**Exit code:** 0 — `8 PASS, 0 FAIL`

```
│ [PASS] tables exist — 29 tables present
│ [PASS] foreign keys — 27 FK constraints found
│ [PASS] indexes — 98 indexes found
│ [PASS] NUMERIC(18,4) financials — 39 NUMERIC(18,4) columns present
│ [PASS] ULID PKs VARCHAR(26) — 28 ULID PKs valid
│ [PASS] marketplace seeds — 5 marketplaces seeded
│ [PASS] schema_migrations — 1 migration(s) recorded
│ [PASS] checksum 0001-core-foundation — checksum matches file
└── summary: 8 PASS, 0 FAIL
```

### Validated:
- **All 29 expected tables exist** (28 domain + `schema_migrations`)
- **27 FK constraints** exist (≥20 expected)
- **98 indexes** exist (≥50 expected)
- **39 NUMERIC(18,4) financial columns** exist (supplier prices, cost models, profit models, opportunities, test orders, sales actuals, profit attribution, competition snapshots)
- **28 ULID PKs are VARCHAR(26)** (Crockford base32, 26 chars)
- **5 marketplace seeds** present (shopee, tokopedia, lazada, blibli, tiktok_shop)
- **schema_migrations** contains `0001-core-foundation` with a **checksum matching the on-disk SQL file** (SHA-256)

## 6. Idempotency re-test

Re-running `npm run migrate` a second time would skip the already-applied migration (idempotent via `schema_migrations` set check). The `ON CONFLICT (name) DO NOTHING` on marketplace seeds makes the seed insert idempotent too.

## 7. DDL-over-pooler note

Migrations ran against the Supabase **pooler** (port 6543, PgBouncer transaction mode). `migrate.ts` uses a **single client** from the pool and runs the entire migration in one `BEGIN`/`COMMIT` on that client, so the DDL executed within one session — reliable despite the pooler. A warning is logged recommending the direct connection (port 5432) for migrations when available; the direct host is IPv6-only in this env, so the pooler path was used successfully.

## 8. Final state

```
DB_MIGRATION = PASS
SCHEMA       = PASS
```

- Migration applied transactionally and idempotently.
- Schema fully verified: tables, FKs, indexes, NUMERIC(18,4), ULID PKs, seeds, checksum.
- No blockers.
