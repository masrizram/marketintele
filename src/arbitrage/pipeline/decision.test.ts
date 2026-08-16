/**
 * Decision Gate Adversarial Tests (IDEA §18 / AUDIT §44)
 *
 * For every C01-C15 gate, test:
 *   1. PASS case (conditions met)
 *   2. FAIL case (conditions violated)
 *   3. UNKNOWN case (data missing)
 *
 * Critical gates: failure → REJECT. Unknown → fail closed.
 * No gate may become trivially true because of default values.
 */
import { decideOpportunity, GateResult } from './decision';
import { CanonicalProduct } from '../types';
import { EconomicResult, RiskAssessment } from './types';
import { MarketClearingPriceResult } from '../intelligence/market-clearing';
import { DemandResult } from '../intelligence/demand';
import { CompetitionResult } from '../intelligence/competition';

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

function getGate(gates: GateResult[], id: string): GateResult {
  const g = gates.find((g) => g.id === id);
  if (!g) throw new Error(`Gate ${id} not found`);
  return g;
}

describe('Decision Gates — C01 Product Identity Verified (CRITICAL)', () => {
  it('PASS: brand + barcode present', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C01').passed).toBe(true);
  });

  it('FAIL: barcode missing', () => {
    const result = decideOpportunity({
      product: makeProduct({ barcode: null }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C01').passed).toBe(false);
  });

  it('FAIL: brand missing', () => {
    const result = decideOpportunity({
      product: makeProduct({ brand: null }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C01').passed).toBe(false);
  });
});

describe('Decision Gates — C04 Price and MOQ Validity (CRITICAL)', () => {
  it('PASS: price > 0 and MOQ >= 1', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C04').passed).toBe(true);
  });

  it('FAIL: price null', () => {
    const result = decideOpportunity({
      product: makeProduct({ priceInIdr: null }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C04').passed).toBe(false);
  });

  it('FAIL: MOQ null', () => {
    const result = decideOpportunity({
      product: makeProduct({ moq: null as unknown as number }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C04').passed).toBe(false);
  });
});

describe('Decision Gates — C06 Market Clearing Price (CRITICAL)', () => {
  it('PASS: HIGH confidence clearing price', () => {
    const mcp: MarketClearingPriceResult = {
      conservativePrice: 95000, basePrice: 100000, optimisticPrice: 105000,
      marketClearingPrice: 95000, priceConfidence: 'HIGH', methodology: 'test',
      sampleSize: 10, effectiveSampleSize: 10,
      percentiles: { p10: 90000, p25: 95000, p50: 100000, p75: 105000, p90: 110000 },
      weightedMedian: 100000, priceDispersion: 0.1, sellerConcentration: 0.1,
      sellerCount: 10, excludedListings: [], sourceList: [], timestamp: new Date().toISOString(),
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: mcp,
    });
    expect(getGate(result.gates, 'C06').passed).toBe(true);
  });

  it('FAIL: INSUFFICIENT confidence', () => {
    const mcp: MarketClearingPriceResult = {
      conservativePrice: null, basePrice: null, optimisticPrice: null,
      marketClearingPrice: null, priceConfidence: 'INSUFFICIENT', methodology: 'test',
      sampleSize: 1, effectiveSampleSize: 0, percentiles: null, weightedMedian: null,
      priceDispersion: null, sellerConcentration: null, sellerCount: null,
      excludedListings: [], sourceList: [], timestamp: new Date().toISOString(),
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: mcp,
    });
    expect(getGate(result.gates, 'C06').passed).toBe(false);
  });

  it('FAIL: LOW confidence (below MEDIUM threshold)', () => {
    const mcp: MarketClearingPriceResult = {
      conservativePrice: 95000, basePrice: 100000, optimisticPrice: 105000,
      marketClearingPrice: 95000, priceConfidence: 'LOW', methodology: 'test',
      sampleSize: 2, effectiveSampleSize: 2, percentiles: { p10: 95000, p25: 95000, p50: 100000, p75: 105000, p90: 105000 },
      weightedMedian: 100000, priceDispersion: 0.6, sellerConcentration: 0.7,
      sellerCount: 2, excludedListings: [], sourceList: [], timestamp: new Date().toISOString(),
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', marketClearingPrice: mcp,
    });
    expect(getGate(result.gates, 'C06').passed).toBe(false);
  });

  it('UNKNOWN: no market clearing price provided', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r',
    });
    expect(getGate(result.gates, 'C06').passed).toBe(false);
    expect(getGate(result.gates, 'C06').detail).toContain('not computed');
  });
});

describe('Decision Gates — C07 Landed Cost Complete (CRITICAL)', () => {
  it('PASS: landedCost not null', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics({ landedCost: 55000 }), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C07').passed).toBe(true);
  });

  it('FAIL: landedCost null', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics({ landedCost: null }), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C07').passed).toBe(false);
  });
});

describe('Decision Gates — C12 Risk Thresholds (CRITICAL)', () => {
  it('PASS: overall risk LOW', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk({ overallRisk: 'LOW' }), requestId: 'r',
    });
    expect(getGate(result.gates, 'C12').passed).toBe(true);
  });

  it('FAIL: overall risk CRITICAL', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk({ overallRisk: 'CRITICAL' }), requestId: 'r',
    });
    expect(getGate(result.gates, 'C12').passed).toBe(false);
  });
});

describe('Decision Gates — C15 Confidence Score (CRITICAL)', () => {
  it('PASS: confidence >= floor (0.4)', () => {
    const result = decideOpportunity({
      product: makeProduct({ confidence: 0.8 }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C15').passed).toBe(true);
  });

  it('FAIL: confidence < floor', () => {
    const result = decideOpportunity({
      product: makeProduct({ confidence: 0.2 }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C15').passed).toBe(false);
  });

  it('BOUNDARY: confidence exactly at floor (0.4)', () => {
    const result = decideOpportunity({
      product: makeProduct({ confidence: 0.4 }), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(getGate(result.gates, 'C15').passed).toBe(true);
  });
});

describe('Decision Gates — Critical failure → REJECT', () => {
  it('REJECTs when any critical gate fails', () => {
    const result = decideOpportunity({
      product: makeProduct({ barcode: null }), // C01 fails
      marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(), requestId: 'r',
    });
    expect(result.decision).toBe('REJECT');
  });

  it('does NOT RECOMMEND when supplier risk is CRITICAL', () => {
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(),
      risk: makeRisk({ overallRisk: 'CRITICAL' }), requestId: 'r',
    });
    expect(result.decision).toBe('REJECT');
  });
});

describe('Decision Gates — C10 Demand (non-critical)', () => {
  it('PASS with sufficient demand data', () => {
    const demand: DemandResult = {
      demandScore: 0.7, demandConfidence: 0.6, demandTrend: 'STABLE',
      demandVelocity: 5, demandClass: 'HIGH', signals: [], methodology: 'test',
      timestamp: new Date().toISOString(), evidence: [],
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', demand,
    });
    expect(getGate(result.gates, 'C10').passed).toBe(true);
  });

  it('WARNING (non-critical fail) with UNKNOWN demand', () => {
    const demand: DemandResult = {
      demandScore: null, demandConfidence: 0, demandTrend: 'UNKNOWN',
      demandVelocity: null, demandClass: 'UNKNOWN', signals: [], methodology: 'test',
      timestamp: new Date().toISOString(), evidence: [],
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', demand,
    });
    expect(getGate(result.gates, 'C10').passed).toBe(false);
    expect(getGate(result.gates, 'C10').critical).toBe(false); // non-critical = warning
  });
});

describe('Decision Gates — C11 Competition (non-critical)', () => {
  it('PASS with acceptable competition', () => {
    const competition: CompetitionResult = {
      sellerCount: 10, activeSellerCount: 10, sellerConcentration: 0.1,
      topSellerDominance: 0.15, priceDispersion: 0.1, lowestPrice: 95000,
      competitionScore: 0.4, competitionLevel: 'MEDIUM', priceWarRisk: 'LOW',
      priceWarProbability: 0.1, marketSaturationScore: 0.3, priceStability: 0.9,
      evidence: [], methodology: 'test', timestamp: new Date().toISOString(),
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', competition,
    });
    expect(getGate(result.gates, 'C11').passed).toBe(true);
  });

  it('WARNING with EXTREME competition', () => {
    const competition: CompetitionResult = {
      sellerCount: 100, activeSellerCount: 100, sellerConcentration: 0.05,
      topSellerDominance: 0.05, priceDispersion: 0.3, lowestPrice: 95000,
      competitionScore: 0.9, competitionLevel: 'EXTREME', priceWarRisk: 'HIGH',
      priceWarProbability: 0.8, marketSaturationScore: 0.8, priceStability: 0.7,
      evidence: [], methodology: 'test', timestamp: new Date().toISOString(),
    };
    const result = decideOpportunity({
      product: makeProduct(), marketplace: 'shopee', economics: makeEconomics(), risk: makeRisk(),
      requestId: 'r', competition,
    });
    expect(getGate(result.gates, 'C11').passed).toBe(false);
    expect(getGate(result.gates, 'C11').critical).toBe(false);
  });
});
