/**
 * Phase 19.8 — Data Freshness Validation Tests
 *
 * Verifies that the decision gate C13 enforces the maximum acceptable
 * age for marketplace observations. STALE data MUST NOT generate a
 * production opportunity.
 *
 * Also verifies the new C13b provenance gate: only REAL_* provenance
 * may pass — TEST_FIXTURE/MOCK/SIMULATION must fail closed.
 */
import { decideOpportunity, GateResult } from './decision';
import { computeEconomics } from './economics';
import { CanonicalProduct } from '../types';
import { EconomicResult, RiskAssessment } from './types';
import type { MarketClearingPriceResult } from '../intelligence/market-clearing';
import { MAX_MARKETPLACE_OBSERVATION_AGE_HOURS } from '../provenance/data-provenance';

function makeProduct(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    id: 'prod_001', canonicalTitle: 'Test', brand: 'Brand', model: 'Model',
    categoryId: null, standardUnit: 'pcs', standardWeightGrams: null,
    standardDimensionsCm: null, sku: 'SKU001', barcode: '8888123456789',
    priceInIdr: 100000, currencyConverted: false, moq: 10, packageQuantity: 1,
    packageUnit: 'pcs', sourceId: 'src_001', supplierProductId: null,
    marketplaceListingId: null, sellerId: 's1', sellerName: 'Seller',
    marketplaceListingUrl: 'https://example.com/p', observedAt: new Date().toISOString(),
    confidence: 0.8,
    dataLineage: { sourceId: 'src_001', rawDocumentId: 'doc_001', rawEvidenceHash: 'hash',
      extractionMethod: 'test', observedAt: new Date().toISOString(), confidence: 0.8,
      evidenceHierarchyLevel: 3 },
    ...overrides,
  };
}

function makeEconomics(overrides: Partial<EconomicResult> = {}): EconomicResult {
  return {
    supplierBaseCost: 40000, landedCost: 55000, landedCostBreakdown: {},
    marketplaceFee: 5000, marketplaceFeeBreakdown: {}, feeConfigUsed: null,
    sellingPriceIdr: 100000, profitCalculation: null, profitError: null,
    ...overrides,
  };
}

function makeRisk(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    overallRisk: 'LOW', supplierRisk: 'LOW', productRisk: 'LOW', marketRisk: 'LOW',
    confidenceScore: 0.8,
    factors: { supplierUnverified: false, dataFreshnessHours: 2, priceVolatility: null,
      priceWarRisk: false, counterfeitRisk: false, operationalRisk: false,
      singleSupplier: false, lowDemandConfidence: false },
    evidence: [],
    ...overrides,
  };
}

function makeMCP(): MarketClearingPriceResult {
  return {
    conservativePrice: 95000, basePrice: 100000, optimisticPrice: 105000,
    marketClearingPrice: 95000, priceConfidence: 'HIGH', methodology: 'test',
    sampleSize: 10, effectiveSampleSize: 10,
    percentiles: { p10: 90000, p25: 95000, p50: 100000, p75: 105000, p90: 110000 },
    weightedMedian: 100000, priceDispersion: 0.1, sellerConcentration: 0.1,
    sellerCount: 10, excludedListings: [], sourceList: [], timestamp: new Date().toISOString(),
  };
}

function getGate(gates: GateResult[], id: string): GateResult {
  const g = gates.find((g) => g.id === id);
  if (!g) throw new Error(`Gate ${id} not found`);
  return g;
}

describe('Phase 19.8 — C13 Data Freshness Gate', () => {
  it('FRESH data (< 24h) passes C13', () => {
    const product = makeProduct({
      observedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
      dataProvenance: 'REAL_PUBLIC_WEB',
    });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13').passed).toBe(true);
  });

  it('STALE data (> 24h) fails C13', () => {
    const product = makeProduct({
      observedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48h ago
      dataProvenance: 'REAL_PUBLIC_WEB',
    });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13').passed).toBe(false);
    expect(getGate(result.gates, 'C13').detail).toContain('STALE');
  });

  it('null timestamp fails C13', () => {
    const product = makeProduct({
      observedAt: '' as any,
      dataProvenance: 'REAL_PUBLIC_WEB',
    });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13').passed).toBe(false);
  });

  it('retrievedAt is used when present (overrides observedAt)', () => {
    const product = makeProduct({
      observedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48h ago (stale)
      retrievedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago (fresh)
      dataProvenance: 'REAL_PUBLIC_WEB',
    });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13').passed).toBe(true);
  });

  it('just under boundary (~23h59m) is FRESH', () => {
    const product = makeProduct({
      observedAt: new Date(Date.now() - 23 * 60 * 60 * 1000 - 59 * 60 * 1000).toISOString(),
      dataProvenance: 'REAL_PUBLIC_WEB',
    });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13').passed).toBe(true);
  });

  it('STALE data → REJECT (no production opportunity)', () => {
    const product = makeProduct({
      observedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      dataProvenance: 'REAL_PUBLIC_WEB',
    });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(result.decision).toBe('REJECT');
    expect(result.evidence.some((e) => e.includes('STALE_DATA'))).toBe(true);
  });

  it('max acceptable age is 24 hours', () => {
    expect(MAX_MARKETPLACE_OBSERVATION_AGE_HOURS).toBe(24);
  });
});

describe('Phase 19.3 — C13b Provenance Gate', () => {
  it('REAL_PUBLIC_WEB passes C13b', () => {
    const product = makeProduct({ dataProvenance: 'REAL_PUBLIC_WEB' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(true);
  });

  it('REAL_PUBLIC_ENDPOINT passes C13b', () => {
    const product = makeProduct({ dataProvenance: 'REAL_PUBLIC_ENDPOINT' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(true);
  });

  it('REAL_OFFICIAL_API passes C13b', () => {
    const product = makeProduct({ dataProvenance: 'REAL_OFFICIAL_API' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(true);
  });

  it('TEST_FIXTURE fails C13b', () => {
    const product = makeProduct({ dataProvenance: 'TEST_FIXTURE' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(false);
  });

  it('MOCK fails C13b', () => {
    const product = makeProduct({ dataProvenance: 'MOCK' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(false);
  });

  it('SIMULATION fails C13b', () => {
    const product = makeProduct({ dataProvenance: 'SIMULATION' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(false);
  });

  it('undefined provenance fails C13b (conservative fail-closed)', () => {
    const product = makeProduct(); // no dataProvenance set
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(false);
  });

  it('TEST_FIXTURE provenance → REJECT', () => {
    const product = makeProduct({ dataProvenance: 'TEST_FIXTURE' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(result.decision).toBe('REJECT');
  });

  it('C13b is a critical gate', () => {
    const product = makeProduct({ dataProvenance: 'TEST_FIXTURE' });
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').critical).toBe(true);
  });
});

describe('Phase 19.7 — Financial Integrity with Provenance', () => {
  it('REAL provenance + FRESH + valid economics may pass (not auto-reject)', () => {
    const product = makeProduct({
      dataProvenance: 'REAL_PUBLIC_WEB',
      observedAt: new Date().toISOString(),
    });
    const economics = computeEconomics(
      product, 'shopee', 100000, 40000, 10, 5000, 'req_real_001',
    );
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics, risk: makeRisk(),
      requestId: 'req_real_001', marketClearingPrice: makeMCP(),
    });
    // C13 and C13b should pass; C07/C08/C09 depend on economics
    expect(getGate(result.gates, 'C13').passed).toBe(true);
    expect(getGate(result.gates, 'C13b').passed).toBe(true);
  });

  it('TEST_FIXTURE provenance blocks even with valid economics', () => {
    const product = makeProduct({
      dataProvenance: 'TEST_FIXTURE',
      observedAt: new Date().toISOString(),
    });
    const economics = computeEconomics(
      product, 'shopee', 100000, 40000, 10, 5000, 'req_fixture_001',
    );
    const result = decideOpportunity({
      product, marketplace: 'shopee', economics, risk: makeRisk(),
      requestId: 'req_fixture_001', marketClearingPrice: makeMCP(),
    });
    expect(getGate(result.gates, 'C13b').passed).toBe(false);
    expect(result.decision).toBe('REJECT');
  });
});
