# PHASE 17.8 — Data Ingestion Contract Validation

**Phase:** 17.8
**Date:** 2026-08-16
**Mode:** EVIDENCE-DRIVEN · verify UNKNOWN != 0 invariant across the entire pipeline

---

## 1. Objective

Verify that the data pipeline can safely represent every required field, and that `UNKNOWN` (null) values for mandatory financial components can **never silently become zero** — they must block the arbitrage calculation (fail-closed).

---

## 2. Field Representation Contract

Every field the pipeline must represent is present in the type system and is nullable where it can be genuinely unknown:

| Field | Type | Nullable | Evidence |
|---|---|---|---|
| Supplier product | `CanonicalProduct` | yes (can be null until matched) | `src/arbitrage/types.ts` |
| Marketplace product | `CanonicalProduct` | yes | `types.ts` |
| Product identity (brand) | `string \| null` | yes | `CanonicalProduct.brand` |
| Product identity (barcode) | `string \| null` | yes | `CanonicalProduct.barcode` |
| SKU | `string \| null` | yes | `CanonicalProduct.sku` |
| Source price | `number \| null` | **yes — `null = unknown, NOT zero`** | `SupplierSource.sourcePriceIdr` (`pipeline/types.ts:59`) |
| Currency | `string` | no | `SupplierPricing.currency` |
| Quantity (MOQ) | `number \| null` | yes | `SupplierSource.moq` |
| Availability (stock) | `number \| null` | yes | `SupplierPricing.stock` |
| Shipping (inbound logistics) | `number \| null` | **yes — `null = unknown`** | `SupplierSource.shippingCostIdr` (`pipeline/types.ts:61`) |
| Fees (marketplace) | `FeeConfigModel` fields `number \| null` | yes | `fee-config.ts` |
| Timestamp (observedAt) | `string` (ISO-8601) | no | `CanonicalProduct.observedAt` |
| Source URL | `string \| null` | yes | `CanonicalProduct.marketplaceListingUrl` |
| Source identity (sourceId) | `ULID` | no | `CanonicalProduct.sourceId` / `DataLineage.sourceId` |
| Confidence | `number` (0–1) | no | `CanonicalProduct.confidence` |
| Provenance | `DataLineage` (rawDocumentId, rawEvidenceHash, extractionMethod, evidenceHierarchyLevel 1–6) | no | `CanonicalProduct.dataLineage` |
| Supplier cost (base) | `Decimal \| null` | **yes — null blocks calculation** | `economics.ts` |
| Landed cost (total) | `number \| null` | **yes — null blocks profit** | `EconomicResult.landedCost` |
| Marketplace fee (total) | `number \| null` | **yes — null blocks profit** | `EconomicResult.marketplaceFee` |

---

## 3. UNKNOWN != 0 Invariant — Layered Enforcement

The invariant "UNKNOWN can never silently become zero" is enforced at **five independent layers**. A failure at any layer blocks the opportunity.

### Layer 1 — Supplier base cost (`src/arbitrage/pipeline/economics.ts:206-227`)

```ts
let supplierBaseCost: Decimal | null;
if (supplierPriceIdr !== null && supplierPriceIdr > 0) {
  supplierBaseCost = D(supplierPriceIdr);
} else {
  supplierBaseCost = null;   // ← UNKNOWN, not 0
  // Returns early with profitError — profit calculation BLOCKED
  return { supplierBaseCost: null, landedCost: null, ..., profitError: 'Supplier base cost is UNKNOWN (null)...' };
}
```
**Result:** UNKNOWN supplier cost → `supplierBaseCost = null` → landed cost null → profit blocked. ✅

### Layer 2 — Landed cost components (`src/arbitrage/economic/landed-cost-config.ts:184-191` + `profit-engine.ts:48-61`)

```ts
const applyRate = (c) => { if (c.value === null) return null; return supplierBaseCost.times(D(c.value)); };
// inboundLogistics is ALWAYS null until a real freight quote is supplied (line 196)
```
`computeLandedCost()`:
```ts
for (const key of REQUIRED_LANDED_COST_COMPONENTS) {
  if (val === null) missing.push(key);
}
if (missing.length > 0) throw new UncalculatedCostException(`Landed cost is INCOMPLETE. Missing: ${missing.join(', ')}. These cannot be assumed 0.`);
```
**Result:** Any null landed-cost component → `UncalculatedCostException` thrown → landed cost null → profit blocked. ✅

### Layer 3 — Marketplace fees (`src/arbitrage/economic/fee-config.ts:94-110`)

```ts
const addRate = (rate, label) => {
  if (rate === null || rate === undefined) throw new FeeConfigurationIncompleteError(`Missing fee '${label}'... — cannot assume 0`);
  components.push(selling.times(rate));
};
```
**Result:** Any null fee → `FeeConfigurationIncompleteError` → marketplace fee null → profit blocked. ✅

### Layer 4 — Profit calculation gating (`economics.ts:324`)

```ts
if (landedCost !== null && marketplaceFee !== null) {
  // compute profit
} else {
  profitError = 'Cannot compute profit without landed cost and marketplace fees';
}
```
**Result:** Profit is computed ONLY when both landed cost and marketplace fee are non-null. ✅

### Layer 5 — Decision gate C07 + C08 (`decision.ts:188-213`)

```ts
// C07 LANDED_COST_COMPLETE_NO_UNKNOWN (CRITICAL)
const hasLandedCost = economics.landedCost !== null;
// C08 MARKETPLACE_FEES_FULLY_CONFIGURED (CRITICAL)
const feesConfigured = economics.marketplaceFee !== null && economics.marketplaceFee > 0;
```
**Result:** Either null → critical gate fails → decision = `REJECT`. ✅

---

## 4. Identity UNKNOWN Invariant

### Product identity (C01 — CRITICAL, `decision.ts:83-95`)
```ts
const hasProductIdentity = product.brand !== null && product.barcode !== null;
```
**Result:** Unknown identity (null brand OR null barcode) → C01 fails → REJECT. ✅

### Supplier identity (C02 — CRITICAL, `decision.ts:98-110`)
```ts
const supplierVerified = risk.factors.supplierUnverified === false && risk.overallRisk !== 'CRITICAL';
```
**Result:** Unverified supplier → C02 fails → REJECT. ✅

---

## 5. Required Behavior Verification Matrix

| Scenario | Required behavior | Enforced by | Verified |
|---|---|---|---|
| Supplier cost UNKNOWN | opportunity MUST NOT be generated | Layer 1 + Layer 4 + C07 | ✅ `economics.ts` early-return + `decision.ts` C07 |
| Marketplace fee UNKNOWN | opportunity MUST NOT be generated | Layer 3 + Layer 4 + C08 | ✅ `fee-config.ts` throw + `decision.ts` C08 |
| Shipping UNKNOWN | opportunity MUST NOT be generated | Layer 2 (`inboundLogistics: null` always until freight quote) + C07 | ✅ `landed-cost-config.ts:196` |
| Identity UNKNOWN (barcode/brand null) | opportunity MUST NOT be generated | C01 | ✅ `decision.ts:83` |
| Supplier identity unverified | opportunity MUST NOT be generated | C02 | ✅ `decision.ts:98` |
| All valid (cost+price+fees+shipping+match) | opportunity MAY be generated (subject to all 15 gates) | All layers pass | ✅ path exists in `pipeline.ts` |

---

## 6. Financial Calculation Integrity

| Property | Verified | Evidence |
|---|---|---|
| **Decimal-safe** | ✅ | `decimal-engine.ts` — precision=28, ROUND_HALF_EVEN; IEEE-754 floats banned; `D()` throws on NaN/Infinity (`decimal-engine.ts:30-42`) |
| **Deterministic** | ✅ | No `Math.random()` in any economic path; scenarios use fixed modifiers (`profit-engine.ts:518-540`); sensitivity matrix uses fixed shift grids (`profit-engine.ts:567-571`) |
| **Provenance-aware** | ✅ | Every cost component carries `source`, `sourceTier`, `confidence`, `configurationVersion` (`landed-cost-config.ts:23-34`); every fee config carries `evidence` with `source`, `sourceTier`, `confidence` (`fee-config.ts:29-35`); products carry `DataLineage` with `rawEvidenceHash` |
| **Fail-closed** | ✅ | 5-layer enforcement above; `UncalculatedCostException`, `FeeConfigurationIncompleteError`, `CalculationConflictError` thrown on any unknown/divergence |
| **Dual-engine reconciliation** | ✅ | `calculateProfitWithValidation()` — Engine A vs Engine B independent reconstruction; reconciled within 1 IDR tolerance; `independentValidation` flag distinguishes genuine independence (`profit-engine.ts:418-456`) |

---

## 7. Pipeline Stage Contract (end-to-end)

| Stage | Input contract | Output contract | UNKNOWN handling |
|---|---|---|---|
| Discovery | query + marketplace | `CanonicalProduct[]` (can be empty) | empty → pipeline returns early, no opportunity |
| Market clearing price | listings[] | `MarketClearingPriceResult` (P25, confidence) | insufficient sample / LOW confidence → C06 fails |
| Matching | marketplace product + candidates | `MatchResult` (matchType, score) | weak match → C01/C05 fail |
| Supplier resolution | canonical product | `SupplierSource \| null` (sourcePriceIdr null when unknown) | null price → Layer 1 blocks |
| Economics | product + supplier price + shipping | `EconomicResult` (landedCost null on unknown) | null → Layers 1–4 block |
| Risk | product + supplier + economics | `RiskAssessment` | CRITICAL risk → C12 fails |
| Decision | economics + risk + intel | `OpportunityResult` (RECOMMEND/REVIEW/REJECT) | any critical gate fail → REJECT |

---

## 8. Contract Validation Conclusion

The data ingestion contract is **fully validated**:
- Every required field is representable and nullable where it can be unknown.
- `UNKNOWN` values are represented as `null` (never coerced to `0`) at every layer.
- Five independent enforcement layers guarantee UNKNOWN mandatory costs block the arbitrage calculation.
- Financial calculations are decimal-safe, deterministic, provenance-aware, and fail-closed.
- The dual-engine reconciliation provides genuine independent validation (not algebraic rearrangement).
- Identity UNKNOWN (barcode/brand/supplier verification) is enforced by critical decision gates.

**No contract violation found.** The pipeline safely represents and fail-closes on unknown data. This is the foundation that makes "empty opportunity results" a *correct* outcome rather than a defect.
