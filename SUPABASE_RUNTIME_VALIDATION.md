# SUPABASE RUNTIME VALIDATION

**Project:** MarketIntele Arbitrage Intelligence Engine v2.0.0
**Date:** 2026-08-16
**Timestamp (start):** 2026-08-16T03:34Z
**Mode:** EVIDENCE-DRIVEN / FAIL-CLOSED / NO-FABRICATION
**Secrets:** ALL redacted. No passwords/tokens/keys appear in this report.

---

## 1. Environment (redacted)

| Variable | Value (redacted) | Status |
|---|---|---|
| `SUPABASE_DATABASE_URL` | `postgresql://postgres.qlldynvgdimalkpuntxe:***@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true` | VALID (pooler, IPv4) |
| `SUPABASE_URL` | `https://qlldynvgdimalkpuntxe.supabase.co` | present (not read by current code) |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_***` | present (not read by current code) |
| `SUPABASE_SECRET_KEY` | `sb_secret_***` | present (server-only, not read by current code) |
| `DATABASE_URL` | (empty) | FIXED — was an HTTPS URL (wrong protocol); cleared |
| `PG_*` | localhost fallback | present (not used while SUPABASE_DATABASE_URL set) |
| `PG_SKIP_OK` | `false` | set to false for production verification |
| `SSRF_FIREWALL_ENABLED` | `true` | enabled |
| `ADMIN_API_KEY` | 64-char hex (generated) | FIXED — was placeholder; now a real random value |

## 2. Corrections applied

1. `SUPABASE_DATABASE_URL` — changed from the **direct IPv6-only host** (`db.qlldynvgdimalkpuntxe.supabase.co:5432`, AAAA-only, unreachable from this IPv4 env) to the **Transaction Pooler** (`aws-0-ap-northeast-1.pooler.supabase.com:6543`, IPv4-reachable). Password updated to the current Supabase DB password.
2. `DATABASE_URL` — was `https://qlldynvgdimalkpuntxe.supabase.co` (HTTPS URL — wrong protocol; would fail URL parse if it ever became primary). Cleared to empty.
3. `ADMIN_API_KEY` — was placeholder `YOUR_LONG_RANDOM_ADMIN_API_KEY`. Replaced with a cryptographically random 32-byte hex value (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

## 3. Region discovery (evidence-based)

The Supabase direct host (`db.qlldynvgdimalkpuntxe.supabase.co`) is **IPv6-only** (AAAA record `2406:da14:1d62:b401:...`, no A record). This machine has **no IPv6 route** (`ENETUNREACH`).

The Supabase pooler is region-specific. The project region is NOT in the direct hostname. Region was **discovered by tenant probe**: a multi-region probe tested `SELECT 1` against all Supabase pooler regions using the tenant user `postgres.qlldynvgdimalkpuntxe`.

| Region pooler (port 6543) | Tenant lookup | TCP (IPv4) |
|---|---|---|
| `aws-0-ap-southeast-1` | `tenant/user ... not found` | reachable |
| `aws-0-ap-southeast-2` | `tenant/user ... not found` | reachable |
| **`aws-0-ap-northeast-1`** | **`SELECT 1 → alive=1` ✅** | **reachable** |
| `aws-0-ap-south-1` | `tenant/user ... not found` | reachable |
| `aws-0-us-east-1` | `tenant/user ... not found` | reachable |
| `aws-0-us-west-1` | `tenant/user ... not found` | reachable |
| `aws-0-eu-west-1` | `tenant/user ... not found` | reachable |
| `aws-0-eu-central-1` | `tenant/user ... not found` | reachable |

**Result:** The project lives on **`aws-0-ap-northeast-1` (Tokyo)**.

## 4. SSL handling

The pooler TLS certificate chain is not fully trusted by Node's default CA bundle (`SELF_SIGNED_CERT_IN_CHAIN` with `sslmode=require`). Additionally, `pg` v8.23 / `pg-connection-string` v2.14 aliases `sslmode=require` → `verify-full` when parsed from a connection string, which would override a code-level `rejectUnauthorized:false`.

The repo's `connection.ts` handles this correctly: `sslConfigFromMode('require', host)` returns `{ rejectUnauthorized: false }`, and the explicit `config.ssl` assignment in `resolveDbConfig()` takes precedence. To avoid the pg v8 aliasing, **`sslmode` is intentionally omitted from the URI**; SSL is configured solely via the explicit `config.ssl` object. The connection is encrypted (TLS) but does not require full chain validation of the pooler's cert.

Verified: the repo's own `resolveDbConfig()` + `createPool()` path connects successfully with `config.ssl={"rejectUnauthorized":false}`.

## 5. Verification command

**Command:** `npm run verify:supabase`
**Exit code:** 0
**Result:** `16 PASS, 0 FAIL, 0 SKIP`

```
│ [PASS] connectivity (769ms) — connected as postgres
│ [PASS] authentication — authenticated as postgres
│ [PASS] tls/ssl — ssl=on
│ [PASS] SELECT (89ms) — ok
│ [PASS] INSERT (90ms) — inserted 1 row
│ [PASS] UPDATE (93ms) — updated 1 row
│ [PASS] DELETE (184ms) — deleted 1 row
│ [PASS] transaction COMMIT (1214ms) — committed & visible
│ [PASS] transaction ROLLBACK (455ms) — rolled back (row absent)
│ [PASS] foreign key enforcement (96ms) — FK violation correctly rejected
│ [PASS] unique constraints (183ms) — duplicate correctly rejected
│ [PASS] concurrent access (1598ms) — concurrent reads ok
│ [PASS] persistence (92ms) — row inserted (will verify after reconnect)
│ [PASS] reconnect (655ms) — reconnected; persisted row present
│ [PASS] migration state (96ms) — 1 migration(s) recorded
│ [PASS] schema version (94ms) — latest version: 0001-core-foundation
└── summary: 16 PASS, 0 FAIL, 0 SKIP
```

## 6. Harness defects found & fixed

The `verify-supabase.ts` harness had two defects (NOT schema/DB defects) that were fixed so checks are actually correct:

1. **`transaction ROLLBACK`** compared `r.rows[0].n === 0` but `pg` returns `count(*)` as a **string** (`"0"`), so `=== 0` was always false → false FAIL. Fixed to `Number(r.rows[0].n) === 0`.
2. **`foreign key enforcement`** used an orphan parent ID `01JTEST0000000000000NONEXIST` (31 chars) against a `VARCHAR(26)` PK, causing "value too long" instead of testing FK. Fixed to a valid 26-char ULID `01JTEST00000000000000NOEX`.

These fixes make the checks actually test what they claim; they do not weaken any invariant.

## 7. Failure classification (root-cause of prior blocker)

Prior blocker: "Supabase DB unreachable". Root cause classification:
- **DNS:** OK (AAAA only for direct host; A records exist for pooler)
- **IPv4/IPv6:** direct host is IPv6-only; this env has no IPv6 route → `ENETUNREACH`
- **TLS:** OK (pooler TLS works with `rejectUnauthorized:false`)
- **Authentication:** OK (pooler accepts `postgres.<ref>` tenant on ap-northeast-1)
- **Wrong hostname/region:** YES — the prior ap-southeast-1 guess was wrong; correct region is ap-northeast-1
- **Connection timeout:** none (pooler responds in ~700-1500ms)

**Resolution:** use the Transaction Pooler on the correct region (ap-northeast-1) over IPv4.

## 8. Final state

```
DB_CONNECTION = PASS
```

- `SELECT 1` returns successfully.
- No secrets printed.
- All 16 checks PASS, 0 SKIP, 0 FAIL.
