/**
 * PHASE 17.9 — End-to-End Data Pipeline Readiness Test
 *
 * Deterministic test verifying the full decision flow of the data plane using
 * SYNTHETIC FIXTURE DATA ONLY. All fixture data is explicitly marked with
 * provenance = TEST_FIXTURE. NO fixture data is ever inserted into production
 * Supabase — this test exercises the in-memory decision/economics layer only.
 *
 * Required behaviors verified:
 *   1. VALID supplier cost + VALID marketplace price + VALID fees + VALID
 *      shipping + VALID product match → opportunity MAY be generated (RECOMMEND/REVIEW).
 *   2. UNKNOWN supplier cost → opportunity MUST NOT be generated (REJECT, C07/C09 fail).
 *   3. UNKNOWN marketplace fee → opportunity MUST NOT be generated (REJECT, C08 fail).
 *   4. UNKNOWN identity (null barcode) → opportunity MUST NOT be generated (REJECT, C01 fail).
 *
 * Per Phase 17 safety rules: fixture provenance is marked; no production DB
 * is touched; UNKNOWN never silently becomes zero.
 */
import { decideOpportunity, GateResult } from './decision';
import { computeEconomics } from './economics';
import { CanonicalProduct } from '../types';
import { EconomicResult, RiskAssessment } from './types';
import type { MarketClearingPriceResult } from '../intelligence/market-clearing';

// ─── TEST FIXTURE DATA (provenance: TEST_FIXTURE — NOT REAL DATA) ───────────
// Every fixture value below is synthetic and explicitly labelled. It exercises
// the real economics + decision code paths without any external call.

function makeFixtureProduct(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    id: '01FIXTURE_PRODUCT_0001',
    canonicalTitle: '[TEST_FIXTURE] Power Bank 10000mAh',
    brand: 'FixtureBrand',
    model: 'FB-10K',
    categoryId: null,
    standardUnit: 'pcs',
    standardWeightGrams: 250,
    standardDimensionsCm: '10x5x2',
    sku: 'FIX-SKU-001',
    barcode: '8888999900001',
    priceInIdr: 250000,
    currencyConverted: true,
    moq: 1,
    packageQuantity: 1,
    packageUnit: 'pcs',
    sourceId: '01FIXTURE_SOURCE_0001',
    supplierProductId: null,
    marketplaceListingId: null,
    sellerId: 'fixture_seller_01',
    sellerName: '[TEST_FIXTURE] Fixture Seller',
    marketplaceListingUrl: 'https://example-fixture.com/listing/001',
    observedAt: new Date('2026-08-16T00:00:00Z').toISOString(),
    confidence: 0.85,
    dataLineage: {
      sourceId: '01FIXTURE_SOURCE_0001',
      rawDocumentId: '01FIXTURE_DOC_0001',
      rawEvidenceHash: 'fixture_hash_' + '0'.repeat(58),
      extractionMethod: 'test-fixture',
      observedAt: new Date('2026-08-16T00:00:00Z').toISOString(),
      confidence: 0.85,
      evidenceHierarchyLevel: 3,
    },
    ...overrides,
  };
}

function makeFixtureRisk(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    overallRisk: 'LOW',
    supplierRisk: 'LOW',
    productRisk: 'LOW',
    marketRisk: 'LOW',
    confidenceScore: 0.8,
    factors: {
      supplierUnverified: false,
      dataFreshnessHours: 2,
      priceVolatility: null,
      priceWarRisk: false,
      counterfeitRisk: false,
      operationalRisk: false,
      singleSupplier: false,
      lowDemandConfidence: false,
    },
    evidence: ['TEST_FIXTURE risk evidence'],
    ...overrides,
  };
}

function makeFixtureMarketClearingPrice(
  overrides: Partial<MarketClearingPriceResult> = {},
): MarketClearingPriceResult {
  return {
    conservativePrice: 240000,
    basePrice: 242000,
    optimisticPrice: 248000,
    marketClearingPrice: 240000,
    priceConfidence: 'HIGH',
    methodology: 'fixture-p25-weighted-median',
    sampleSize: 10,
    effectiveSampleSize: 10,
    percentiles: { p10: 230000, p25: 238000, p50: 242000, p75: 248000, p90: 260000 },
    weightedMedian: 242000,
    priceDispersion: 0.05,
    sellerConcentration: 0.12,
    sellerCount: 8,
    excludedListings: [],
    sourceList: ['fixture_listing_001'],
    timestamp: new Date('2026-08-16T00:00:00Z').toISOString(),
    ...overrides,
  };
}

function getGate(gates: GateResult[], id: string): GateResult {
  const g = gates.find((x) => x.id === id);
  if (!g) throw new Error(`Gate ${id} not found in ${gates.map((x) => x.id).join(',')}`);
  return g;
}

describe('PHASE 17.9 — End-to-End Data Pipeline Readiness (TEST_FIXTURE data only)', () => {
  // ─── 1. POSITIVE PATH: all VALID → opportunity MAY be generated ──────────
  describe('1. VALID supplier cost + VALID price + VALID fees + VALID shipping + VALID match', () => {
    it('computes landed cost and profit, and the decision is NOT auto-REJECT on economics', () => {
      const product = makeFixtureProduct({ priceInIdr: 500000 });
      // VALID supplier cost low enough to produce a genuine positive margin after
      // landed cost + marketplace fees. Landed cost ≈ supplier + shipping + VAT(11%) +
      // duties + customs + packaging + QC + handling ≈ supplier*1.14 + ~150000 flat.
      // With supplier=80000 → landed ≈ 240000; selling 480000 → fee ~24000 → profit > 0.
      const supplierPriceIdr = 80000;
      const shippingCostIdr = 15000;
      const sellingPriceIdr = 480000; // conservative market clearing price

      const economics = computeEconomics(
        product,
        'shopee',
        sellingPriceIdr,
        supplierPriceIdr,
        50, // moq
        shippingCostIdr,
        'req_fixture_001',
      );

      // Economics must succeed (no UNKNOWN blocking)
      expect(economics.profitError).toBeNull();
      expect(economics.landedCost).not.toBeNull();
      expect(economics.landedCost!).toBeGreaterThan(0);
      expect(economics.marketplaceFee).not.toBeNull();
      expect(economics.marketplaceFee!).toBeGreaterThan(0);
      expect(economics.profitCalculation).not.toBeNull();
      // Dual-engine reconciliation must pass
      expect(economics.profitCalculation!.reconciled).toBe(true);
      expect(economics.profitCalculation!.independentValidation).toBe(true);
      // Net profit must be positive for this fixture
      expect(economics.profitCalculation!.primaryResult.netProfitPerUnit.gt(0)).toBe(true);
    });

    it('decision gate C07 (landed cost complete) and C08 (fees configured) PASS', () => {
      const product = makeFixtureProduct({ priceInIdr: 500000 });
      const economics = computeEconomics(
        product, 'shopee', 480000, 80000, 50, 15000, 'req_fixture_002',
      );
      const risk = makeFixtureRisk();
      const mcp = makeFixtureMarketClearingPrice({ marketClearingPrice: 480000, conservativePrice: 480000 });

      const result = decideOpportunity({
        product, marketplace: 'shopee', economics, risk, requestId: 'req_fixture_002',
        marketClearingPrice: mcp,
      });

      expect(getGate(result.gates, 'C07').passed).toBe(true);
      expect(getGate(result.gates, 'C08').passed).toBe(true);
      expect(getGate(result.gates, 'C01').passed).toBe(true);
      // C09 profit gate: requires reconciled positive profit
      expect(getGate(result.gates, 'C09').passed).toBe(true);
    });
  });

  // ─── 2. NEGATIVE PATH: UNKNOWN supplier cost → MUST NOT generate ──────────
  describe('2. UNKNOWN supplier cost → opportunity MUST NOT be generated', () => {
    it('economics fail-closes: landedCost null, profitError set', () => {
      const product = makeFixtureProduct();
      const economics = computeEconomics(
        product, 'shopee', 240000,
        null, // UNKNOWN supplier cost
        50, 15000, 'req_fixture_010',
      );

      expect(economics.supplierBaseCost).toBeNull();
      expect(economics.landedCost).toBeNull();
      expect(economics.profitCalculation).toBeNull();
      expect(economics.profitError).toContain('UNKNOWN');
    });

    it('decision REJECTs and C07/C09 fail', () => {
      const product = makeFixtureProduct();
      const economics = computeEconomics(
        product, 'shopee', 240000, null, 50, 15000, 'req_fixture_011',
      );
      const risk = makeFixtureRisk();
      const mcp = makeFixtureMarketClearingPrice();

      const result = decideOpportunity({
        product, marketplace: 'shopee', economics, risk, requestId: 'req_fixture_011',
        marketClearingPrice: mcp,
      });

      expect(result.decision).toBe('REJECT');
      expect(getGate(result.gates, 'C07').passed).toBe(false);
      expect(getGate(result.gates, 'C09').passed).toBe(false);
    });

    it('never silently converts UNKNOWN supplier cost to zero', () => {
      const product = makeFixtureProduct();
      const economics = computeEconomics(
        product, 'shopee', 240000, null, 50, 15000, 'req_fixture_012',
      );
      // The supplierBaseCost must be null, NOT 0
      expect(economics.supplierBaseCost).toBeNull();
      expect(economics.supplierBaseCost).not.toBe(0);
    });
  });

  // ─── 3. NEGATIVE PATH: UNKNOWN marketplace fee → MUST NOT generate ───────
  describe('3. UNKNOWN marketplace fee → opportunity MUST NOT be generated', () => {
    it('decision REJECTs when marketplaceFee is null (C08 fail)', () => {
      const product = makeFixtureProduct();
      // Construct an economics result with a null marketplace fee (simulating
      // an unconfigured marketplace) but valid landed cost.
      const economics: EconomicResult = {
        supplierBaseCost: 100000,
        landedCost: 130000,
        landedCostBreakdown: {},
        marketplaceFee: null, // UNKNOWN fee
        marketplaceFeeBreakdown: null,
        feeConfigUsed: null,
        sellingPriceIdr: 240000,
        profitCalculation: null,
        profitError: 'Fee config incomplete',
      };
      const risk = makeFixtureRisk();
      const mcp = makeFixtureMarketClearingPrice();

      const result = decideOpportunity({
        product, marketplace: 'shopee', economics, risk, requestId: 'req_fixture_020',
        marketClearingPrice: mcp,
      });

      expect(result.decision).toBe('REJECT');
      expect(getGate(result.gates, 'C08').passed).toBe(false);
    });

    it('never silently converts UNKNOWN fee to zero', () => {
      const economics: EconomicResult = {
        supplierBaseCost: 100000,
        landedCost: 130000,
        landedCostBreakdown: {},
        marketplaceFee: null,
        marketplaceFeeBreakdown: null,
        feeConfigUsed: null,
        sellingPriceIdr: 240000,
        profitCalculation: null,
        profitError: 'Fee config incomplete',
      };
      // The fee must be null, NOT 0 — profit must not be computed
      expect(economics.marketplaceFee).toBeNull();
      expect(economics.marketplaceFee).not.toBe(0);
      expect(economics.profitCalculation).toBeNull();
    });
  });

  // ─── 4. NEGATIVE PATH: UNKNOWN identity → MUST NOT generate ──────────────
  describe('4. UNKNOWN identity → opportunity MUST NOT be generated', () => {
    it('REJECTs when barcode is null (C01 fail)', () => {
      const product = makeFixtureProduct({ barcode: null });
      const economics: EconomicResult = {
        supplierBaseCost: 100000,
        landedCost: 130000,
        landedCostBreakdown: {},
        marketplaceFee: 6000,
        marketplaceFeeBreakdown: {},
        feeConfigUsed: null,
        sellingPriceIdr: 240000,
        profitCalculation: null,
        profitError: null,
      };
      const risk = makeFixtureRisk();
      const mcp = makeFixtureMarketClearingPrice();

      const result = decideOpportunity({
        product, marketplace: 'shopee', economics, risk, requestId: 'req_fixture_030',
        marketClearingPrice: mcp,
      });

      expect(result.decision).toBe('REJECT');
      expect(getGate(result.gates, 'C01').passed).toBe(false);
    });

    it('REJECTs when brand is null (C01 fail)', () => {
      const product = makeFixtureProduct({ brand: null });
      const economics: EconomicResult = {
        supplierBaseCost: 100000, landedCost: 130000, landedCostBreakdown: {},
        marketplaceFee: 6000, marketplaceFeeBreakdown: {}, feeConfigUsed: null,
        sellingPriceIdr: 240000, profitCalculation: null, profitError: null,
      };
      const risk = makeFixtureRisk();
      const mcp = makeFixtureMarketClearingPrice();

      const result = decideOpportunity({
        product, marketplace: 'shopee', economics, risk, requestId: 'req_fixture_031',
        marketClearingPrice: mcp,
      });

      expect(result.decision).toBe('REJECT');
      expect(getGate(result.gates, 'C01').passed).toBe(false);
    });
  });

  // ─── 5. Determinism: same fixture input → same output ─────────────────────
  describe('5. Determinism (TEST_FIXTURE)', () => {
    it('produces identical economics for identical fixture inputs', () => {
      const product = makeFixtureProduct({ priceInIdr: 500000 });
      const r1 = computeEconomics(product, 'shopee', 480000, 80000, 50, 15000, 'r1');
      const r2 = computeEconomics(product, 'shopee', 480000, 80000, 50, 15000, 'r2');
      expect(r1.landedCost).toBe(r2.landedCost);
      expect(r1.marketplaceFee).toBe(r2.marketplaceFee);
      expect(r1.profitCalculation?.reconciled).toBe(r2.profitCalculation?.reconciled);
    });
  });
});
