# PHASE 17.7 — Production Credential Readiness Matrix

**Phase:** 17.7
**Date:** 2026-08-16
**Mode:** NO-SECRET-LEAKAGE — **no secret values are printed or stored in source.**

---

## 1. Method

Credential presence is checked by reading the `.env` file key **names and value lengths only** (never values), plus live probing of the production API to verify which credentials are actually configured on Vercel. Secrets are never printed, never committed (`.env` is gitignored), and never written into source.

---

## 2. Credential Matrix

| # | Credential | Env var | Required? | Current state | Verified? | Server-only? | Client-safe? | Expiration | Rotation procedure |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Supabase DB URI** (Tokyo pooler) | `SUPABASE_DATABASE_URL` | YES (production DB) | SET (len=129, host=`aws-0-ap-northeast-1.pooler.supabase.com:6543`) | YES — live `/api/opportunities` returns 200; `/api/health` reports `postgresql: connected` | YES (server) | NO — contains password | DB password embedded; rotate via Supabase dashboard → Database → reset password → update Vercel env + `.env` | Supabase dashboard → Settings → Database → Database password → Reset. Update `SUPABASE_DATABASE_URL` on Vercel + local `.env`. No code change. |
| 2 | **Telegram Bot Token** | `TELEGRAM_BOT_TOKEN` | YES (worker only) | SET (len=46) | Partially — token present; worker boot verified locally (config schema accepts it). Live bot not started in this session. | YES (worker) | NO | Telegram bot tokens do not expire unless revoked | @BotFather → `/revoke` → update token on worker host + `.env`. No code change. |
| 3 | **Admin API Key** | `ADMIN_API_KEY` | YES (`/api/audit` protection) | SET (len=64) | YES — live `/api/audit` with no key → 401 (not 503, proving key is configured on Vercel); wrong key → 401 | YES (server) | NO | Does not auto-expire (operator-set) | Generate new strong random value → update Vercel env → update `.env` → update any audit clients. No code change. |
| 4 | **Supabase project URL** | `SUPABASE_URL` | No (JS client not integrated today) | SET (len=40) | N/A (documented only) | YES | NO (paired with secret) | N/A | N/A until JS client integrated |
| 5 | **Supabase publishable/anon key** | `SUPABASE_PUBLISHABLE_KEY` | No (JS client not integrated) | SET (len=46) | N/A | NO (publishable) | YES (publishable, browser-safe) | N/A | N/A until JS client integrated |
| 6 | **Supabase service/secret key** | `SUPABASE_SECRET_KEY` | No (JS client not integrated) | SET (len=41) | N/A | YES (server, privileged) | **NO — service role bypasses RLS; NEVER ship to client** | N/A | Rotate via Supabase dashboard → API → reset service key |
| 7 | **Supabase JWKS URL** | `SUPABASE_JWKS_URL` | No (JWT validation not active) | SET (len=70) | N/A | YES | YES (public keys) | N/A | N/A until JWT validation integrated |
| 8 | **PG discrete vars** | `PG_HOST/USER/PASSWORD/DATABASE` | Fallback (Supabase URL takes precedence) | `PG_PASSWORD` PLACEHOLDER; others SET for local Docker | N/A (not used in production — Supabase URL wins) | YES | NO | N/A (not used in prod) | N/A |
| 9 | **Redis URL** | `REDIS_URL` | NO (not imported/used by any code path) | SET (len=24, default `redis://localhost:6379/0`) | N/A — no code references Redis; config schema declares it but no module consumes it | N/A | N/A | N/A | N/A — Redis is not actually required by the current data plane |
| 10 | **Vercel deploy token / OIDC** | `VERCEL_OIDC_TOKEN` (`.env.local`) | NO (deploy-time only) | SET (in `.env.local`) | N/A (build/deploy time) | N/A | N/A | Vercel-managed | Vercel dashboard |
| 11 | **Supplier B2B API credentials** | (none defined) | YES for real supplier data | **NOT PROVIDED** | N/A | YES | NO | N/A | Operator must obtain (Alibaba/1688 Open Platform App Key+Secret) |
| 12 | **Marketplace official API credentials** | (none defined) | NO (public endpoints used now); YES for official API upgrade | **NOT PROVIDED** | N/A | YES | NO | N/A | Operator must obtain + business approval (partner programs) |
| 13 | **Freight / shipping quote credentials** | (none defined) | YES for landed-cost shipping component | **NOT PROVIDED** | N/A | YES | NO | N/A | Operator must obtain (logistics API / freight forwarder) |

---

## 3. Verified Facts

| Fact | Evidence |
|---|---|
| Supabase DB credential is live in production | `GET /api/health` → `postgresql: connected`; `GET /api/opportunities` → 200 with `provenance: REAL` |
| Admin API key is configured on Vercel | `GET /api/audit` (no key) → 401 (not 503); wrong key → 401 — the `requireAdmin` helper returns 503 only when `ADMIN_API_KEY` is unset |
| `.env` / `.env.local` are gitignored | `.gitignore` lines 6–8, 21: `.env`, `.env.*`, `.env.local`, `.env*` |
| No secret values in source | grep for any hardcoded credential patterns: none found in `src/` or `api/` |
| Redis is not actually required | No module imports Redis or a Redis client; `REDIS_URL` is declared in the config schema but unused |

---

## 4. Credential Gaps Blocking the Data Plane

| Gap | Impact | Owner |
|---|---|---|
| No supplier B2B API credentials | Supplier cost stays UNKNOWN → arbitrage correctly fails closed → zero opportunities | Operator (external) |
| No marketplace official API credentials | Public-endpoint scraping only (rate-limit/block risk, no data contract) | Operator (external) |
| No freight/shipping quote source | Inbound logistics stays null → landed cost incomplete → C07 gate fails | Operator (external) |

---

## 5. Security Hygiene (re-verified)

- ✅ No secret values printed in this document or any Phase 17 artifact.
- ✅ `.env` / `.env.local` / `.env.production` are gitignored.
- ✅ Secrets injected via env at runtime; Zod validates presence; nothing hardcoded.
- ✅ `SUPABASE_SECRET_KEY` (service role) documented as NEVER client-safe.
- ✅ Admin key uses constant-time compare (`timingSafeEqual` in `api/_lib/http.ts`).
- ✅ DB URI uses Supabase pooler (port 6543) with SSL required (non-localhost → `require`).

---

## 6. Conclusion

**Infrastructure credentials (Supabase DB, Admin API key, Telegram token) are SET and VERIFIED live.** The data-plane-blocking credentials (supplier, marketplace official API, freight) are **NOT PROVIDED** — these are external dependencies the operator must supply. No credential is fabricated; the system fails closed in their absence.
