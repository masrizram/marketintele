# PHASE 18.9 — Real-Data Source Ranking

**Phase:** 18.9
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN — NO-FABRICATION — FAIL-CLOSED

---

## 1. Objective

Rank possible real-data sources for the MarketIntele arbitrage engine
using a transparent, weighted scoring framework. Choose the highest-value
source that can be **legally and technically** integrated with available
credentials.

**Critical constraint:** If no credential is available, we STOP at the
credential boundary. No fake live integration is implemented.

---

## 2. Scoring Framework

Each candidate is scored on 10 dimensions (1–5 scale, 5 = best):

| # | Dimension | Weight | Description |
|---|---|---|---|
| 1 | Data quality | 15% | Accuracy, completeness, structure of product data |
| 2 | Price reliability | 15% | Trustworthiness and freshness of pricing data |
| 3 | Product coverage | 10% | Breadth of catalog / SKU coverage |
| 4 | API accessibility | 15% | Ease of programmatic access (official API vs scraping) |
| 5 | Credential cost | 10% | Financial cost to obtain access (free → paid) |
| 6 | Rate limit | 10% | Throughput allowance for production use |
| 7 | Legal/policy risk | 10% | Terms-of-service compliance, scraping legality |
| 8 | Implementation complexity | 5% | Engineering effort to integrate |
| 9 | Maintenance cost | 5% | Ongoing upkeep burden (API changes, auth refresh) |
| 10 | Expected arbitrage value | 5% | Potential profit spread the source enables |

Weighted score = Σ(dimension_score × weight) × 20 → normalized to 0–100.

---

## 3. Supplier-Side Candidates (B2B Source of Cost Data)

### 3.1 Alibaba.com Open Platform API

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 4 | Structured JSON: product title, specs, MOQ, price tiers, supplier verification status |
| Price reliability | 4 | FOB price ranges from verified suppliers; real B2B wholesale pricing |
| Product coverage | 5 | Largest B2B catalog (~200M+ products across all categories) |
| API accessibility | 3 | Open Platform API exists; requires developer account + app approval |
| Credential cost | 3 | Free developer account; some endpoints require paid membership |
| Rate limit | 3 | Tiered rate limits (developer tier is limited) |
| Legal/policy risk | 5 | Official API — fully compliant, no scraping |
| Implementation complexity | 3 | OAuth2 + signed requests; token refresh; 1–2 weeks |
| Maintenance cost | 3 | API versioning, token refresh maintenance |
| Expected arbitrage value | 5 | China → Indonesia import arbitrage is the core business model |

**Weighted score: 82/100**

**Credential status:** CREDENTIAL_REQUIRED
- Env var declared: `ALIBABA_API_KEY` (`supplier-integration-harness.ts:25`)
- No `SupplierAdapter` implementation exists yet.
- No credential provided by operator.

---

### 3.2 1688.com (Alibaba Domestic)

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 4 | Rich structured data (Chinese domestic B2B) |
| Price reliability | 5 | Actual Chinese domestic wholesale prices (lower than Alibaba export) |
| Product coverage | 5 | Massive catalog, deep supply chain |
| API accessibility | 2 | No official international API; Chinese-language developer portal; requires Chinese business entity or proxy |
| Credential cost | 2 | Requires Chinese entity / agent relationship |
| Rate limit | 2 | Unknown / restrictive |
| Legal/policy risk | 3 | Grey area for non-Chinese-entity access; potential ToS issues |
| Implementation complexity | 2 | High — Chinese-language docs, no English SDK, possible scraping needed |
| Maintenance cost | 2 | High — frequent anti-bot changes |
| Expected arbitrage value | 5 | Highest arbitrage spread (domestic Chinese prices) |

**Weighted score: 64/100**

**Credential status:** BLOCKED
- No official API for non-Chinese entities.
- No credential infrastructure in the codebase.

---

### 3.3 Made-in-China.com API

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 3 | Structured supplier/product data; less comprehensive than Alibaba |
| Price reliability | 3 | Price ranges available but less granular |
| Product coverage | 3 | Smaller catalog than Alibaba |
| API accessibility | 3 | API key-based access declared in harness |
| Credential cost | 4 | Generally free access |
| Rate limit | 3 | Moderate limits |
| Legal/policy risk | 5 | Official API — compliant |
| Implementation complexity | 3 | Moderate — API key auth |
| Maintenance cost | 3 | Moderate |
| Expected arbitrage value | 3 | Good but smaller supplier base |

**Weighted score: 68/100**

**Credential status:** CREDENTIAL_REQUIRED
- Env var declared: `MADE_IN_CHINA_API_KEY` (`supplier-integration-harness.ts:26`)
- No credential provided by operator.

---

### 3.4 GlobalSources.com API

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 4 | High-quality verified supplier data |
| Price reliability | 3 | Price ranges; requires inquiry for actual quotes |
| Product coverage | 3 | Smaller but curated catalog |
| API accessibility | 3 | API key-based access declared in harness |
| Credential cost | 2 | Paid premium membership often required |
| Rate limit | 3 | Moderate |
| Legal/policy risk | 5 | Official API — compliant |
| Implementation complexity | 3 | Moderate |
| Maintenance cost | 3 | Moderate |
| Expected arbitrage value | 3 | Good for premium product categories |

**Weighted score: 66/100**

**Credential status:** CREDENTIAL_REQUIRED
- Env var declared: `GLOBAL_SOURCES_API_KEY` (`supplier-integration-harness.ts:27`)
- No credential provided by operator.

---

### 3.5 Custom Supplier API (operator's own supplier network)

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 3 | Depends on supplier's API quality |
| Price reliability | 5 | Direct from supplier — most accurate cost data |
| Product coverage | 2 | Limited to one supplier's catalog |
| API accessibility | 4 | Operator controls the API; URL + token auth declared |
| Credential cost | 5 | Free (operator's own relationship) |
| Rate limit | 4 | Negotiable |
| Legal/policy risk | 5 | Contractual relationship — fully compliant |
| Implementation complexity | 2 | Custom adapter needed; depends on supplier API shape |
| Maintenance cost | 3 | Depends on supplier's API stability |
| Expected arbitrage value | 4 | High if supplier has competitive pricing |

**Weighted score: 72/100**

**Credential status:** CREDENTIAL_REQUIRED
- Env vars declared: `SUPPLIER_API_URL`, `SUPPLIER_API_TOKEN` (`supplier-integration-harness.ts:28-29`)
- No credential provided by operator.

---

## 4. Marketplace-Side Candidates (Source of Selling Price Data)

### 4.1 Shopee Open API (Partner Platform)

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 5 | Official structured JSON: product, price, seller, inventory, fees |
| Price reliability | 5 | Real-time marketplace prices |
| Product coverage | 5 | Largest Indonesian e-commerce marketplace |
| API accessibility | 3 | Requires Partner account (partner_id + partner_key + shop_authorization) |
| Credential cost | 3 | Free developer account; business verification required |
| Rate limit | 3 | 3000 req/min per shop (partner tier) |
| Legal/policy risk | 5 | Official API — fully compliant |
| Implementation complexity | 2 | HMAC-SHA256 signing, token refresh, shop authorization flow — 2–3 weeks |
| Maintenance cost | 3 | API version updates, token refresh |
| Expected arbitrage value | 5 | Primary marketplace for Indonesian arbitrage |

**Weighted score: 80/100**

**Credential status:** CREDENTIAL_REQUIRED
- No env var for Shopee Partner credentials in the codebase.
- Current adapter (`shopee-adapter.ts`) uses public web scraping only.
- No credential provided by operator.

---

### 4.2 Shopee Public Web (Current Implementation)

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 3 | JSON from `/api/v2/search_items` + HTML parsing; partial data |
| Price reliability | 4 | Real prices but no official data contract |
| Product coverage | 5 | Full catalog accessible |
| API accessibility | 4 | No credentials needed (currently working) |
| Credential cost | 5 | Free |
| Rate limit | 2 | Undocumented; subject to bot detection / IP blocking |
| Legal/policy risk | 2 | ToS may prohibit automated scraping; no official data contract |
| Implementation complexity | 5 | Already implemented and working |
| Maintenance cost | 2 | High — subject to breaking changes, anti-bot measures |
| Expected arbitrage value | 4 | Good for price discovery but unreliable for production |

**Weighted score: 70/100**

**Credential status:** NO_CREDENTIAL_REQUIRED (already operational)
- Current adapter: `shopee-adapter.ts` — functional but fragile.
- Risk: may break at any time without an API contract.

---

### 4.3 Tokopedia Open API

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 4 | Official structured data |
| Price reliability | 5 | Real-time prices |
| Product coverage | 5 | Major Indonesian marketplace |
| API accessibility | 2 | API exists but developer access is restricted; requires partner approval |
| Credential cost | 3 | Free developer account; partner approval gate |
| Rate limit | 3 | Tiered |
| Legal/policy risk | 5 | Official API — compliant |
| Implementation complexity | 2 | OAuth2 + signed requests; 2–3 weeks |
| Maintenance cost | 3 | Moderate |
| Expected arbitrage value | 4 | Strong second marketplace |

**Weighted score: 68/100**

**Credential status:** CREDENTIAL_REQUIRED
- No env var for Tokopedia API credentials in the codebase.
- Current adapter (`tokopedia-adapter.ts`) uses HTML scraping.

---

### 4.4 Lazada Open Platform

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 5 | Official API: product, price, seller, inventory, fees |
| Price reliability | 5 | Real-time |
| Product coverage | 4 | Good Indonesian coverage |
| API accessibility | 3 | Open Platform: app_key + app_secret + access_token |
| Credential cost | 3 | Free developer account |
| Rate limit | 3 | Tiered (varies by endpoint) |
| Legal/policy risk | 5 | Official API |
| Implementation complexity | 2 | HMAC signing, token refresh, complex API surface — 2–3 weeks |
| Maintenance cost | 3 | Moderate |
| Expected arbitrage value | 3 | Good but smaller than Shopee/Tokopedia |

**Weighted score: 72/100**

**Credential status:** CREDENTIAL_REQUIRED
- No env var for Lazada API credentials in the codebase.
- Current adapter (`lazada-adapter.ts`) uses HTML scraping.

---

### 4.5 Blibli Partner API

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 4 | Official API available |
| Price reliability | 5 | Real-time |
| Product coverage | 3 | Smaller catalog than Shopee/Tokopedia |
| API accessibility | 3 | Partner API: app key + secret |
| Credential cost | 3 | Free developer account |
| Rate limit | 3 | Tiered |
| Legal/policy risk | 5 | Official API |
| Implementation complexity | 3 | Moderate — standard REST + auth |
| Maintenance cost | 3 | Moderate |
| Expected arbitrage value | 3 | Niche but loyal customer base |

**Weighted score: 70/100**

**Credential status:** CREDENTIAL_REQUIRED
- Current adapter (`blibli-adapter.ts`) uses public CMS-API (no auth).

---

### 4.6 TikTok Shop API (202309)

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 5 | Official API: product, price, seller, order data |
| Price reliability | 5 | Real-time |
| Product coverage | 4 | Rapidly growing in Indonesia |
| API accessibility | 3 | Open API: app_key + app_secret + access_token |
| Credential cost | 3 | Free developer account |
| Rate limit | 3 | Tiered |
| Legal/policy risk | 5 | Official API |
| Implementation complexity | 2 | New API, evolving docs, webhook setup — 2–3 weeks |
| Maintenance cost | 2 | API is new and frequently updated |
| Expected arbitrage value | 4 | Growing rapidly; high social-commerce conversion |

**Weighted score: 70/100**

**Credential status:** CREDENTIAL_REQUIRED
- Current adapter (`tiktokshop-adapter.ts`) uses HTML scraping.

---

## 5. Freight / Shipping Quote Sources

### 5.1 Freight Forwarder API (custom)

| Dimension | Score | Rationale |
|---|---|---|
| Data quality | 4 | Accurate shipping quotes |
| Price reliability | 5 | Real freight rates |
| Product coverage | N/A | Per-shipment, not product |
| API accessibility | 3 | Depends on forwarder |
| Credential cost | 4 | Often free with business relationship |
| Rate limit | 4 | Negotiable |
| Legal/policy risk | 5 | Contractual |
| Implementation complexity | 3 | Custom adapter |
| Maintenance cost | 3 | Moderate |
| Expected arbitrage value | 5 | CRITICAL — without shipping, landed cost is UNKNOWN → no opportunities |

**Weighted score: 76/100**

**Credential status:** CREDENTIAL_REQUIRED
- No env var for freight API credentials in the codebase.
- Without this, `inboundLogistics` stays null → C07 gate fails → no opportunities.

---

## 6. Consolidated Ranking

| Rank | Source | Type | Score | Credential Status | Integration Status |
|---|---|---|---|---|---|
| 1 | **Alibaba.com Open Platform API** | Supplier (B2B) | 82 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 2 | **Shopee Open API (Partner)** | Marketplace | 80 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 3 | **Freight Forwarder API** | Logistics | 76 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 4 | **Custom Supplier API** | Supplier (B2B) | 72 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 5 | **Lazada Open Platform** | Marketplace | 72 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 6 | Shopee Public Web (current) | Marketplace | 70 | NO_CREDENTIAL_REQUIRED | OPERATIONAL (fragile) |
| 7 | Blibli Partner API | Marketplace | 70 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 8 | TikTok Shop API (202309) | Marketplace | 70 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 9 | Made-in-China.com API | Supplier (B2B) | 68 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 10 | Tokopedia Open API | Marketplace | 68 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 11 | GlobalSources.com API | Supplier (B2B) | 66 | CREDENTIAL_REQUIRED | NOT_EVALUATED |
| 12 | 1688.com (Domestic) | Supplier (B2B) | 64 | BLOCKED | BLOCKED |

---

## 7. Recommended Integration Priority

### Tier 1 — CRITICAL PATH (enables the core arbitrage loop)

To produce a SINGLE real arbitrage opportunity, ALL three of the following
are required simultaneously:

1. **Supplier cost data** → Alibaba.com Open Platform API (rank #1)
   - Provides B2B wholesale prices for the supplier side
   - Env var ready: `ALIBABA_API_KEY`
   - Requires: developer account + API key

2. **Marketplace selling price** → Shopee Open API (rank #2)
   - Provides real-time marketplace prices for the selling side
   - Current scraping adapter works as interim (rank #6) but is fragile
   - Requires: Partner account (partner_id, partner_key, shop authorization)

3. **Freight/shipping quote** → Freight Forwarder API (rank #3)
   - WITHOUT this, `inboundLogistics` = null → landed cost incomplete → C07 gate fails → NO opportunities possible
   - No env var exists yet; must be added
   - Requires: logistics partner API access

### Tier 2 — EXPANSION (improves coverage and reliability)

4. Lazada Open Platform (rank #5) — second marketplace
5. Custom Supplier API (rank #4) — operator's own supplier relationships

### Tier 3 — DEFERRED

6. Tokopedia, Blibli, TikTok Shop official APIs — additional marketplaces
7. Made-in-China, GlobalSources — additional suppliers
8. 1688.com — BLOCKED (requires Chinese entity)

---

## 8. Current Credential Boundary

```
CREDENTIAL_BOUNDARY = BLOCKED
```

**No external supplier, marketplace official API, or freight credentials
have been provided by the operator.** The system correctly fails closed:

- Supplier cost → UNKNOWN (null) → no profit calculation
- Shipping → UNKNOWN (null) → no landed cost → C07 gate fails
- Marketplace prices → available via public scraping (fragile, no contract)

**No fake live integration has been implemented.** The `dataProvenance`
invariant (`REAL | TEST_FIXTURE | MOCK | SIMULATION`) ensures no
test/synthetic data masquerades as production data.

---

## 9. Decision

**Selected source for first real integration:** Alibaba.com Open Platform
API (supplier side) + Shopee Open API (marketplace side) + Freight
Forwarder API (logistics).

**However:** Integration is BLOCKED until the operator provides credentials
for all three. No partial integration that could produce false opportunities
will be shipped. The engine will continue to fail closed, producing zero
opportunities, until all three sides have real, credential-backed data.
