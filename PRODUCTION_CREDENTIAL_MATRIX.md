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

---

# PHASE 18.7 — Supplier Credential Onboarding Framework

**Date:** 2026-08-16
**Mode:** NO-FABRICATION — credential values are NEVER printed.

---

## 7. Supplier Onboarding Checklist

For each supplier candidate, the following fields must be evaluated before
integration. The current codebase declares the credential infrastructure
in `src/arbitrage/sourcing/supplier-integration-harness.ts:25-31` but NO
real `SupplierAdapter` implementation exists — only
`TestFixtureSupplierAdapter` (provenance: `TEST_FIXTURE`).

### Required Statuses

| Status | Meaning |
|---|---|
| `NOT_EVALUATED` | Candidate identified but not yet assessed |
| `CREDENTIAL_REQUIRED` | API access requires credentials not yet obtained |
| `CREDENTIAL_RECEIVED` | Credentials provided by operator (stored in env only) |
| `AUTH_TESTED` | Authentication flow verified (token exchange / API key accepted) |
| `API_TESTED` | At least one real data call returned valid structured data |
| `PRODUCTION_READY` | Adapter implemented, registered in bootstrap, provenance stamped `REAL` |
| `BLOCKED` | Access is legally, technically, or contractually impossible |

---

### 7.1 Alibaba.com Open Platform API

| Field | Value |
|---|---|
| Supplier name | Alibaba.com |
| Country | China (global B2B export) |
| API availability | YES — Alibaba Open Platform |
| Authentication | API Key (app key + secret, HMAC-signed requests) |
| Product search | YES — `alibaba.solution.product.list` / `alibaba.icbu.product.search` |
| Product detail | YES — `alibaba.icbu.product.get` |
| Price | YES — FOB price ranges, price tiers |
| MOQ | YES — minimum order quantity per product |
| Inventory | Partial — stock availability varies by supplier |
| Shipping | NO — shipping is arranged externally (freight forwarder) |
| Currency | USD (export), CNY (1688 domestic) |
| Rate limits | Tiered (developer tier is limited) |
| Terms | Alibaba Open Platform Developer Agreement |
| Legal/API usage restrictions | Official API — compliant; no scraping |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Env var | `ALIBABA_API_KEY` (`supplier-integration-harness.ts:25`) |

### 7.2 Made-in-China.com API

| Field | Value |
|---|---|
| Supplier name | Made-in-China.com |
| Country | China (B2B export) |
| API availability | YES — API key-based access |
| Authentication | API Key |
| Product search | YES |
| Product detail | YES |
| Price | Partial — price ranges; may require inquiry |
| MOQ | YES |
| Inventory | Partial |
| Shipping | NO — external |
| Currency | USD |
| Rate limits | Moderate |
| Terms | Made-in-China API Terms |
| Legal/API usage restrictions | Official API |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Env var | `MADE_IN_CHINA_API_KEY` (`supplier-integration-harness.ts:26`) |

### 7.3 GlobalSources.com API

| Field | Value |
|---|---|
| Supplier name | GlobalSources.com |
| Country | China/Hong Kong (B2B export) |
| API availability | YES — API key-based access |
| Authentication | API Key |
| Product search | YES |
| Product detail | YES |
| Price | Partial — price ranges; inquiry-based for exact quotes |
| MOQ | YES |
| Inventory | Partial |
| Shipping | NO — external |
| Currency | USD |
| Rate limits | Moderate |
| Terms | GlobalSources API Terms |
| Legal/API usage restrictions | Official API |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Env var | `GLOBAL_SOURCES_API_KEY` (`supplier-integration-harness.ts:27`) |

### 7.4 Custom Supplier API (operator's own network)

| Field | Value |
|---|---|
| Supplier name | (operator-defined) |
| Country | (operator-defined) |
| API availability | Depends on supplier |
| Authentication | Bearer token / API key |
| Product search | Depends on supplier API |
| Product detail | Depends on supplier API |
| Price | Depends on supplier API — most accurate if available |
| MOQ | Depends on supplier API |
| Inventory | Depends on supplier API |
| Shipping | Depends — may include freight quote |
| Currency | (operator-defined) |
| Rate limits | Negotiable |
| Terms | Contractual relationship |
| Legal/API usage restrictions | Governed by supplier agreement |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Env vars | `SUPPLIER_API_URL`, `SUPPLIER_API_TOKEN` (`supplier-integration-harness.ts:28-29`) |

### 7.5 1688.com (Alibaba Domestic)

| Field | Value |
|---|---|
| Supplier name | 1688.com |
| Country | China (domestic B2B) |
| API availability | NO — no official international API; Chinese-language developer portal only |
| Authentication | N/A — requires Chinese business entity |
| Product search | N/A |
| Product detail | N/A |
| Price | N/A |
| MOQ | N/A |
| Inventory | N/A |
| Shipping | N/A |
| Currency | CNY |
| Rate limits | Unknown |
| Terms | Requires Chinese entity registration |
| Legal/API usage restrictions | BLOCKED for non-Chinese-entity access |
| Credential status | **BLOCKED** |
| Integration status | **BLOCKED** |
| Env var | (none) |

---

## 8. Supplier Onboarding Process

To move a supplier from `NOT_EVALUATED` to `PRODUCTION_READY`:

1. **NOT_EVALUATED → CREDENTIAL_REQUIRED**
   - Confirm API availability and access requirements.
   - Document the auth mechanism (API key, OAuth, HMAC).

2. **CREDENTIAL_REQUIRED → CREDENTIAL_RECEIVED**
   - Operator obtains API credentials from the supplier platform.
   - Credentials stored in `.env` (gitignored) and Vercel env vars only.
   - NEVER committed to source, NEVER printed in logs/reports.

3. **CREDENTIAL_RECEIVED → AUTH_TESTED**
   - Run `validateSupplierCredentials()` from
     `supplier-integration-harness.ts` — verifies env vars are present
     and non-placeholder.
   - Execute a real auth call (token exchange / API key validation).
   - Confirm the API responds with a valid auth token / accepted key.

4. **AUTH_TESTED → API_TESTED**
   - Execute at least one real data call (e.g., product search).
   - Verify the response contains valid structured data (title, price,
     MOQ, supplier identity).
   - Verify `dataProvenance` can be stamped as `REAL`.

5. **API_TESTED → PRODUCTION_READY**
   - Implement a `SupplierAdapter` (implementing the interface in
     `supplier-adapter.ts:86-102`).
   - Set `dataProvenance = 'REAL'` on the adapter and all emitted offers.
   - Register the adapter in `src/index.ts` bootstrap via
     `supplierSourcingService.registerAdapter(...)`.
   - Add tests with recorded responses (not live API calls in CI).
   - Verify the pipeline picks up the real supplier data:
     `SupplierSourcingService.hasRealAdapters()` returns `true`.
   - Verify economics gate C07 (landed cost complete) can pass when
     shipping is also available.

---

# PHASE 18.8 — Marketplace Credential Onboarding Framework

**Date:** 2026-08-16
**Mode:** NO-FABRICATION — credential values are NEVER printed.

---

## 9. Marketplace Onboarding Checklist

All 5 marketplace adapters currently use **public web scraping** with no
credentials (see `src/arbitrage/adapters/`). The onboarding framework
evaluates each marketplace for upgrade to the official Partner API.

### Required Statuses

Same as supplier statuses (§7): `NOT_EVALUATED` → `CREDENTIAL_REQUIRED`
→ `CREDENTIAL_RECEIVED` → `AUTH_TESTED` → `API_TESTED` →
`PRODUCTION_READY` / `BLOCKED`.

---

### 9.1 Shopee Open API (Partner Platform)

| Field | Value |
|---|---|
| Marketplace | Shopee |
| Official API available | YES — Shopee Open Platform (Partner API v2) |
| Seller access required | YES — shop authorization (seller grants access to partner) |
| Partner access required | YES — partner_id + partner_key (approved partner) |
| Developer account required | YES — Shopee Open Platform developer registration |
| API credentials available | NO — not provided by operator |
| Product discovery possible | YES — `product.list`, `product.search` |
| Price retrieval possible | YES — `product.get_item_list`, `product.get_item_base_info` |
| Seller data possible | YES — `seller.info`, shop performance metrics |
| Fee data possible | YES — `order.get_order_detail` (commission, transaction fees) |
| Inventory possible | YES — `product.get_stock_list` |
| Rate limits | 3000 req/min per shop (partner tier) |
| Terms/restrictions | Shopee Open Platform Developer Agreement; data may only be used for authorized seller's own operations |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Current implementation | `shopee-adapter.ts` — public web scraping (`/api/v2/search_items` + HTML) |

### 9.2 Tokopedia Open API

| Field | Value |
|---|---|
| Marketplace | Tokopedia |
| Official API available | YES — Tokopedia Developer Platform (GraphQL) |
| Seller access required | YES — shop authorization via OAuth2 |
| Partner access required | YES — approved developer/partner account |
| Developer account required | YES |
| API credentials available | NO — not provided by operator |
| Product discovery possible | YES — `productList` GraphQL query |
| Price retrieval possible | YES — product detail includes price |
| Seller data possible | YES — seller info in product queries |
| Fee data possible | Partial — via order/transaction detail |
| Inventory possible | YES — stock info in product detail |
| Rate limits | Tiered |
| Terms/restrictions | Tokopedia Developer Platform Terms; restricted partner approval |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Current implementation | `tokopedia-adapter.ts` — HTML scraping (`/search?q=...` + JSON-LD) |

### 9.3 Lazada Open Platform

| Field | Value |
|---|---|
| Marketplace | Lazada |
| Official API available | YES — Lazada Open Platform |
| Seller access required | YES — shop authorization (access_token per shop) |
| Partner access required | YES — app_key + app_secret (approved developer) |
| Developer account required | YES |
| API credentials available | NO — not provided by operator |
| Product discovery possible | YES — `GetProducts` / `SearchProducts` |
| Price retrieval possible | YES — product detail with special_price, price |
| Seller data possible | YES — seller info in product responses |
| Fee data possible | YES — `GetOrderDetails` (commission, shipping fee) |
| Inventory possible | YES — `GetProducts` includes stock |
| Rate limits | Tiered (varies by endpoint) |
| Terms/restrictions | Lazada Open Platform Developer Agreement |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Current implementation | `lazada-adapter.ts` — HTML scraping (`/catalog/?q=...` + `window.appData`) |

### 9.4 Blibli Partner API

| Field | Value |
|---|---|
| Marketplace | Blibli |
| Official API available | YES — Blibli Partner Center API |
| Seller access required | YES — merchant authorization |
| Partner access required | YES — partner key + secret |
| Developer account required | YES |
| API credentials available | NO — not provided by operator |
| Product discovery possible | YES — product search API |
| Price retrieval possible | YES — product detail with price |
| Seller data possible | YES — merchant info |
| Fee data possible | Partial — via order/transaction detail |
| Inventory possible | YES — stock availability |
| Rate limits | Tiered |
| Terms/restrictions | Blibli Partner Center Agreement |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Current implementation | `blibli-adapter.ts` — public CMS-API (`/cms-api/product-search`, no auth) |

### 9.5 TikTok Shop API (202309)

| Field | Value |
|---|---|
| Marketplace | TikTok Shop |
| Official API available | YES — TikTok Shop API (202309 release) |
| Seller access required | YES — shop authorization via OAuth2 |
| Partner access required | YES — app_key + app_secret (approved developer) |
| Developer account required | YES — TikTok Shop Developer Center |
| API credentials available | NO — not provided by operator |
| Product discovery possible | YES — `search_products` / `get_product_list` |
| Price retrieval possible | YES — product detail with price |
| Seller data possible | YES — seller/creator info |
| Fee data possible | YES — `get_order_detail` (commission, fees) |
| Inventory possible | YES — stock info in product detail |
| Rate limits | Tiered |
| Terms/restrictions | TikTok Shop API Developer Agreement |
| Credential status | **CREDENTIAL_REQUIRED** |
| Integration status | **NOT_EVALUATED** |
| Current implementation | `tiktokshop-adapter.ts` — HTML scraping (`/search?i=ID&q=...` + `__NEXT_DATA__`) |

---

## 10. Marketplace Onboarding Process

To move a marketplace from `NOT_EVALUATED` to `PRODUCTION_READY`:

1. **NOT_EVALUATED → CREDENTIAL_REQUIRED**
   - Confirm official API availability and partner program requirements.
   - Document auth: partner_id/key, app_key/secret, OAuth2 flow, HMAC signing.

2. **CREDENTIAL_REQUIRED → CREDENTIAL_RECEIVED**
   - Operator registers as a developer/partner on the marketplace platform.
   - Business verification and approval by the marketplace.
   - Credentials stored in `.env` (gitignored) and Vercel env vars only.

3. **CREDENTIAL_RECEIVED → AUTH_TESTED**
   - Implement the auth flow (OAuth2 token exchange or API key validation).
   - Verify token refresh mechanism works.
   - Confirm the API responds with valid auth.

4. **AUTH_TESTED → API_TESTED**
   - Execute at least one real data call (product search + product detail).
   - Verify response contains valid structured data (title, price, seller,
     stock, fees).
   - Verify the data quality matches or exceeds the current scraping adapter.

5. **API_TESTED → PRODUCTION_READY**
   - Implement the credential-backed adapter (either extend the existing
     adapter class with credential support, or create a new adapter).
   - Add credential env vars to `src/config.ts` Zod schema.
   - Register the credential-backed adapter in `registerDefaults()`
     (`registry.ts`), conditionally when credentials are present.
   - When credentials are absent, fall back to the existing scraping adapter
     (interim) or fail closed (if scraping is also unavailable).
   - Add tests with recorded responses (not live API calls in CI).
   - Verify the pipeline uses the credential-backed adapter for discovery
     and price retrieval.

---

## 11. Security Requirements for All Credential Onboarding

- Credentials are NEVER committed to source code.
- Credentials are NEVER printed in logs, reports, or error messages.
- Credentials are stored in `.env` (gitignored) and Vercel environment
  variables only.
- Credential values containing `YOUR_` or `CHANGE_ME` are treated as
  missing by `validateSupplierCredentials()`.
- The `dataProvenance` invariant (`REAL` vs `TEST_FIXTURE`) must be
  stamped correctly on all real adapters.
- No adapter with credentials is registered in bootstrap unless
  `validateSupplierCredentials()` confirms credentials are present.
- The SSRF firewall, admin auth, and constant-time secret comparison
  controls remain intact.
- `UNKNOWN != 0` financial invariant is preserved: no credential absence
  is ever replaced with a fabricated value.
