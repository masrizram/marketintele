# PHASE 17.5 & 17.6 — Supplier & Marketplace Integration Readiness

**Phase:** 17.5 (Supplier) + 17.6 (Marketplace)
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN · NO-FABRICATION · stop at the credential boundary

---

## PART A — SUPPLIER INTEGRATION (Phase 17.5)

### A.1 Existing Supplier Abstraction (verified)

The supplier subsystem is architecturally complete and fail-closed:

| Component | File | Status |
|---|---|---|
| Supplier entity model | `src/arbitrage/sourcing/supplier-adapter.ts` — `SupplierSourceEntity` | Implemented (FACTORY/MANUFACTURER/DISTRIBUTOR/IMPORTER/WHOLESALER/TRADING_COMPANY/RESELLER/UNKNOWN) |
| Supplier pricing model | `supplier-adapter.ts` — `SupplierPricing` (`unitPriceIdr: number \| null`) | Implemented — **null = UNKNOWN, never 0** |
| Supplier offer model | `supplier-adapter.ts` — `SupplierOffer` (supplier + pricing + matchConfidence + evidence) | Implemented |
| Supplier adapter interface | `supplier-adapter.ts` — `SupplierAdapter` (`searchSuppliers`, `verifySupplier`, `healthCheck`) | Implemented |
| Sourcing orchestration | `src/arbitrage/sourcing/supplier-sourcing-service.ts` | Implemented — fail-closed (null when no adapter) |
| Offer → pipeline mapping | `supplier-adapter.ts` — `offerToSupplierSource()` | Implemented (preserves UNKNOWN invariant) |
| Test-fixture adapter | `src/arbitrage/sourcing/test-fixture-supplier-adapter.ts` | Implemented — `TEST_FIXTURE` provenance, dev only |
| Fallback resolver | `src/arbitrage/pipeline/supplier.ts` — `resolveSupplier()` | Implemented — derives from marketplace seller; returns `sourcePriceIdr: null` (UNKNOWN) |

### A.2 Supplier Data Models — fields supported

| Model field | Supported | Evidence |
|---|---|---|
| Supplier identity (id, name, type, legalName) | ✅ | `SupplierSourceEntity` |
| Location (country, province, city, address) | ✅ | `SupplierSourceEntity` |
| Contact (phone, email, website, domain, catalogUrl) | ✅ | `SupplierSourceEntity` |
| Verification status (UNVERIFIED→HIGH_CONFIDENCE) | ✅ | `SupplierSourceEntity` |
| Supplier score / confidence (0–1) | ✅ | `SupplierSourceEntity` |
| Unit price (IDR, nullable) | ✅ | `SupplierPricing.unitPriceIdr` |
| Currency | ✅ | `SupplierPricing.currency` |
| MOQ | ✅ | `SupplierPricing.moq` |
| Price tiers (qty breaks) | ✅ | `SupplierPricing.priceTiers` |
| Tax included / shipping included | ✅ | `SupplierPricing` |
| Lead time (days) | ✅ | `SupplierPricing.leadTimeDays` |
| Stock | ✅ | `SupplierPricing.stock` |
| Payment terms | ✅ | `SupplierPricing.paymentTerms` |
| Valid-until (price TTL) | ✅ | `SupplierPricing.validUntil` |
| Shipping cost (freight quote) | ❌ separate | `offerToSupplierSource` sets `shippingCostIdr: null` — requires a separate freight quote (UNKNOWN != 0) |
| Provenance (REAL/TEST_FIXTURE/MOCK) | ✅ | `SupplierPricing.dataProvenance` + `SupplierSourceEntity.dataProvenance` |
| Timestamp / freshness | ✅ | `observedAt` set at offer conversion; pipeline applies TTL decay |

### A.3 Supplier Credential / Readiness Matrix

**No real supplier adapter is registered.** `supplierSourcingService` has 0 adapters → returns `supplier: null, dataProvenance: 'NONE'`. The pipeline correctly falls back to marketplace-seller derivation, which sets `sourcePriceIdr: null` (UNKNOWN), causing the economics engine to fail closed. **This is correct behavior.**

| Supplier source | API available? | Credentials available? | Auth method | Endpoint known? | Rate limit known? | Product search? | Price? | Inventory? | MOQ? | Shipping? | Provenance? | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Alibaba (B2B) | Yes (Open API / 1688) | **NO** | OAuth2 / App Key+Secret | Yes (api.alibaba.com) | Yes (documented) | Yes | Yes | Partial | Yes | Via freight API | Would be REAL | **CREDENTIAL-BLOCKED** |
| 1688.com (China domestic B2B) | Yes (Alibaba Open Platform) | **NO** | App Key+Secret + OAuth | Yes | Yes | Yes | Yes | Yes | Yes | Separate | Would be REAL | **CREDENTIAL-BLOCKED** |
| Global Sources | Partial (API + scraping) | **NO** | Account / API key | Partial | Unknown | Yes | Yes | Partial | Yes | Separate | Would be REAL | **CREDENTIAL-BLOCKED** |
| Kompass / B2B directories | Partial (API) | **NO** | API key | Partial | Unknown | Yes | Partial | No | Partial | No | Would be REAL | **CREDENTIAL-BLOCKED** |
| Custom supplier CSV/EDI ingestion | N/A (file-based) | **NO** | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Would be REAL | **NO DATA PROVIDED** |

### A.4 Supplier Integration Decision — STOP at credential boundary

**Per the hard safety rules (rules 4, 6, 14):** No supplier prices are fabricated. No fake supplier credentials are created. No synthetic production opportunities are generated.

**The supplier integration is BLOCKED at the credential boundary.** The architecture is ready to accept a real `SupplierAdapter` implementation the moment credentials are provided. Until then:
- `supplierSourcingService.searchSuppliers()` returns `null` (fail-closed).
- The arbitrage pipeline's supplier stage returns `sourcePriceIdr: null`.
- The economics engine blocks profit calculation (`UncalculatedCostException`).
- The decision gate C07 (Landed Cost Complete) fails → opportunity REJECTED.
- **Empty opportunity results are the CORRECT, expected behavior.**

**Required input to unblock:** Real B2B supplier API credentials (Alibaba Open Platform App Key/Secret, or equivalent) OR a real supplier product/pricing data feed. These must be provided by the operator — they cannot be fabricated.

---

## PART B — MARKETPLACE INTEGRATION (Phase 17.6)

### B.1 Marketplace Adapter Inventory (verified)

5 marketplace adapters, all registered via `registerDefaults()`, all extending `BaseSourceAdapter` (SSRF firewall + rate limiting + redirect-safe fetch):

| Marketplace | Adapter | baseUrl | Endpoint type | Auth required? |
|---|---|---|---|---|
| Shopee ID | `ShopeeAdapter` | `https://shopee.co.id` | Public search API (`/api/v2/search_items/`) + HTML | No (browser-like headers) |
| Tokopedia | `TokopediaAdapter` | `https://www.tokopedia.com` | Public search page + GraphQL | No (browser-like headers) |
| Lazada ID | `LazadaAdapter` | `https://www.lazada.co.id` | Public search + HTML | No (browser-like headers) |
| Blibli | `BlibliAdapter` | `https://www.blibli.com` | Public CMS-API product search | No (browser-like headers) |
| TikTok Shop | `TikTokShopAdapter` | `https://www.tiktok.com` | Public search + HTML | No (browser-like headers) |

### B.2 Marketplace Capability Classification

Per the required categories. Classification key:
- **IMPL** = implemented (code exists and is exercised)
- **PARTIAL** = partially implemented (some fields missing)
- **CRED-BLOCKED** = requires official API credentials not available
- **POLICY-BLOCKED** = requires business access / seller-partner approval
- **N/A** = not applicable to a read-only discovery adapter

| Capability | Shopee | Tokopedia | Lazada | Blibli | TikTok Shop |
|---|---|---|---|---|---|
| **DISCOVERY** (search by keyword) | IMPL (search API) | IMPL (search page) | IMPL (search page) | IMPL (CMS-API) | IMPL (search page) |
| **PRODUCT DATA** (title/brand/model/sku/barcode) | PARTIAL (barcode often null) | PARTIAL (barcode from mpn fallback) | PARTIAL (barcode from mdv) | PARTIAL (barcode from ean) | PARTIAL (barcode from ean/upc) |
| **PRICE** (current IDR price) | IMPL (micro-units /100000) | IMPL (parsed from page) | IMPL | IMPL | IMPL |
| **STOCK** (availability/sold count) | PARTIAL (soldCount from historical_sold; stock not always exposed) | PARTIAL (soldCount often null) | PARTIAL (soldCount null) | PARTIAL (soldCount when present) | PARTIAL (soldCount from salesTip) |
| **SELLER** (sellerId/sellerName) | IMPL (shopid) | PARTIAL (often null in search; from structured data in fetch) | IMPL | IMPL (merchant code) | IMPL (merchantId) |
| **FEES** (marketplace commission/transaction/payment) | N/A adapter → from `fee-config` model (confirmed rates) | N/A adapter → from `fee-config` | N/A adapter → from `fee-config` | N/A adapter → from `fee-config` | N/A adapter → from `fee-config` |
| **SHIPPING** (inbound/outbound freight) | N/A adapter → requires separate freight quote (UNKNOWN) | N/A → UNKNOWN | N/A → UNKNOWN | N/A → UNKNOWN | N/A → UNKNOWN |
| **ORDER VALIDATION** (test-order feasibility) | N/A (read-only discovery; order flow is a separate Phase) | N/A | N/A | N/A | N/A |
| **API AUTH** (official partner API) | CRED-BLOCKED (Shopee Open Platform needs partner key) | CRED-BLOCKED (Tokopedia OpenAPI needs client_id/secret) | CRED-BLOCKED (Lazada Open Platform needs app key) | CRED-BLOCKED (Blibli Partner API needs credentials) | CRED-BLOCKED (TikTok Shop API needs app key) |
| **RATE LIMIT** | Unknown (public endpoints; subject to blocking) | Unknown | Unknown | Unknown | Unknown |
| **PROVENANCE** (data lineage + evidence hash) | IMPL (`dataLineage`, `rawEvidenceHash`, evidenceHierarchy=3) | IMPL | IMPL | IMPL | IMPL |

### B.3 Marketplace Readiness Assessment

**Implemented (read-only public discovery):** All 5 adapters perform keyword search against public marketplace endpoints and parse results into canonical products with provenance. They use browser-like headers and the SSRF firewall. **No fabricated data** — empty results on failure.

**Partially implemented:** Product identity (barcode/brand) is often null because public listings don't always expose barcodes — this is a real-world data limitation, not a defect. The decision gate C01 (Product Identity Verified) correctly fails closed when barcode is absent.

**Credential-blocked (official APIs):** Each marketplace offers an official Open Platform / Partner API with authenticated, rate-limited, structured access (better than public scraping). None are integrated because no credentials exist. Upgrading to official APIs would require:
- Shopee Open Platform: partner key + secret + shop authorization
- Tokopedia OpenAPI: client_id + client_secret + seller authorization
- Lazada Open Platform: app key + secret + seller authorization
- Blibli Partner API: partner credentials
- TikTok Shop API: app key + secret + shop authorization

**Policy/business-access blocked:** Order validation and the full seller-side fee/return data require seller-partner access (the operator must be a registered seller/partner), which is a business-approval gate, not a code gate.

### B.4 Marketplace "Live Integration" Status

**Per hard safety rule 14:** "DO NOT claim an integration is live unless a real authenticated request succeeds against the real service."

- The 5 marketplace adapters perform **unauthenticated public-endpoint** requests. They are "implemented" (code exists) but are **NOT "live authenticated integrations"** — they rely on public endpoints that can be rate-limited or blocked at any time without notice.
- A **live authenticated integration** requires official API credentials and a successful authenticated request. **None of the 5 marketplaces meet this bar today.**
- Therefore the marketplace integration status is: **IMPLEMENTED (public discovery) / CREDENTIAL-BLOCKED (official API)**.

### B.5 Marketplace Integration Decision

**No fabrication.** The public-endpoint adapters remain as-is (they correctly return empty data on failure and never fabricate listings). Upgrading to official authenticated APIs is **deferred until credentials are provided by the operator** — this is an external dependency boundary, not a code defect.

---

## PART C — Combined Required Input to Unblock the Data Plane

| Input | Owner | Type |
|---|---|---|
| Supplier B2B API credentials (Alibaba/1688 or equivalent) | Operator | External credential |
| Marketplace official API credentials (any of the 5) | Operator | External credential + business approval |
| Real supplier product/pricing data feed (alternative to API) | Operator | External data |
| Freight/shipping quote source | Operator | External service/credential |

**Until these are provided, the arbitrage engine correctly produces ZERO opportunities (fail-closed by design).** This is the single largest blocker to reaching `PRODUCTION_DATA_PLANE_READY`.
