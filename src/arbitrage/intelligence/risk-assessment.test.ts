import { assessComprehensiveRisk } from './risk-assessment';
import { CanonicalProduct } from '../types';
import { SupplierSource, EconomicResult } from '../pipeline/types';
import { DemandResult } from './demand';
import { CompetitionResult } from './competition';
import { DecayResult } from './opportunity-decay';

function makeProduct(): CanonicalProduct {
  return {
    id: 'prod_001', canonicalTitle: 'Test Product', brand: 'Brand', model: 'Model',
    categoryId: null, standardUnit: 'pcs', standardWeightGrams: null,
    standardDimensionsCm: null, sku: 'SKU001', barcode: '8888123456789',
    priceInIdr: 100000, currencyConverted: false, moq: 1, packageQuantity: 1,
    packageUnit: 'pcs', sourceId: 'src_001', supplierProductId: null,
    marketplaceListingId: null, sellerId: 'seller_1', sellerName: 'Seller',
    marketplaceListingUrl: 'https://example.com/product',
    observedAt: new Date().toISOString(), confidence: 0.7,
    dataLineage: { sourceId: 'src_001', rawDocumentId: 'doc_001', rawEvidenceHash: 'hash',
      extractionMethod: 'test', observedAt: new Date().toISOString(), confidence: 0.7,
      evidenceHierarchyLevel: 3 },
  };
}

function makeSupplier(): SupplierSource {
  return {
    id: 'sup_001', name: 'Test Supplier', type: 'MANUFACTURER',
    sourceUrl: 'https://factory.example.com', sourcePriceIdr: 40000, moq: 50,
    shippingCostIdr: 10000, contactInfo: 'sales@factory.com',
    evidence: 'verified', confidence: 'PARTIALLY_VERIFIED', confidenceScore: 0.6,
    observedAt: new Date().toISOString(),
  };
}

function makeEconomics(): EconomicResult {
  return {
    supplierBaseCost: 40000, landedCost: 55000, landedCostBreakdown: {},
    marketplaceFee: 5000, marketplaceFeeBreakdown: {}, feeConfigUsed: null,
    sellingPriceIdr: 100000, profitCalculation: null, profitError: null,
  };
}

describe('Comprehensive Risk — 11 dimensions (IDEA §27)', () => {
  it('assesses all 11 risk dimensions', () => {
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand: null, competition: null, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    expect(result.dimensions.length).toBe(11);
    const names = result.dimensions.map((d) => d.name);
    expect(names).toContain('supplier_risk');
    expect(names).toContain('product_risk');
    expect(names).toContain('market_risk');
    expect(names).toContain('competition_risk');
    expect(names).toContain('price_risk');
    expect(names).toContain('demand_risk');
    expect(names).toContain('operational_risk');
    expect(names).toContain('regulatory_risk');
    expect(names).toContain('data_quality_risk');
    expect(names).toContain('staleness_risk');
    expect(names).toContain('execution_risk');
  });

  it('each dimension has score, confidence, level, evidence, mitigation', () => {
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand: null, competition: null, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    for (const dim of result.dimensions) {
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(1);
      expect(dim.confidence).toBeGreaterThanOrEqual(0);
      expect(dim.level).toBeDefined();
      expect(dim.evidence).toBeTruthy();
      expect(dim.mitigation).toBeTruthy();
    }
  });

  it('fail-closed: overall = max(weighted avg, critical dimension)', () => {
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand: null, competition: null, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    const criticalDims = result.dimensions.filter((d) => d.level === 'CRITICAL');
    if (criticalDims.length > 0) {
      const criticalMax = Math.max(...criticalDims.map((d) => d.score));
      expect(result.overallScore).toBeGreaterThanOrEqual(criticalMax);
    }
  });
});

describe('Comprehensive Risk — supplier risk dimension', () => {
  it('increases supplier risk when supplier is UNKNOWN', () => {
    const unknownSupplier = { ...makeSupplier(), confidence: 'UNKNOWN' as const, confidenceScore: 0.1 };
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: unknownSupplier, economics: makeEconomics(),
      demand: null, competition: null, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    const supplierRisk = result.dimensions.find((d) => d.name === 'supplier_risk')!;
    expect(supplierRisk.score).toBeGreaterThanOrEqual(0.5);
    expect(['HIGH', 'CRITICAL']).toContain(supplierRisk.level);
  });

  it('increases supplier risk when price is null', () => {
    const noPriceSupplier = { ...makeSupplier(), sourcePriceIdr: null };
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: noPriceSupplier, economics: makeEconomics(),
      demand: null, competition: null, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    const supplierRisk = result.dimensions.find((d) => d.name === 'supplier_risk')!;
    expect(supplierRisk.score).toBeGreaterThan(0.3);
  });
});

describe('Comprehensive Risk — staleness with decay data', () => {
  it('flags staleCriticalData from decay', () => {
    const decay: DecayResult = {
      opportunityAgeHours: 48, decayFactor: 0.25, halfLifeHours: 24, freshness: 'STALE',
      priceChangeVelocity: null, supplierPriceChangeVelocity: null, competitionChangeVelocity: null,
      opportunityValidNow: false, estimatedExpiryHours: 100, staleCriticalData: true,
      evidence: [], methodology: 'test', timestamp: new Date().toISOString(),
    };
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand: null, competition: null, decay, marketplace: 'shopee', requestId: 'req_test',
    });
    const staleRisk = result.dimensions.find((d) => d.name === 'staleness_risk')!;
    expect(staleRisk.score).toBeGreaterThanOrEqual(0.5);
  });

  it('low staleness for fresh opportunity', () => {
    const decay: DecayResult = {
      opportunityAgeHours: 2, decayFactor: 0.94, halfLifeHours: 24, freshness: 'FRESH',
      priceChangeVelocity: null, supplierPriceChangeVelocity: null, competitionChangeVelocity: null,
      opportunityValidNow: true, estimatedExpiryHours: 100, staleCriticalData: false,
      evidence: [], methodology: 'test', timestamp: new Date().toISOString(),
    };
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand: null, competition: null, decay, marketplace: 'shopee', requestId: 'req_test',
    });
    const staleRisk = result.dimensions.find((d) => d.name === 'staleness_risk')!;
    expect(staleRisk.score).toBeLessThan(0.3);
  });
});

describe('Comprehensive Risk — with demand + competition data', () => {
  it('uses demand data for demand_risk dimension', () => {
    const demand: DemandResult = {
      demandScore: 0.8, demandConfidence: 0.7, demandTrend: 'RISING',
      demandVelocity: 5, demandClass: 'HIGH', signals: [], methodology: 'test',
      timestamp: new Date().toISOString(), evidence: [],
    };
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand, competition: null, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    const demandRisk = result.dimensions.find((d) => d.name === 'demand_risk')!;
    expect(demandRisk.score).toBeLessThan(0.3); // high demand = low risk
  });

  it('uses competition data for competition_risk + price_war', () => {
    const competition: CompetitionResult = {
      sellerCount: 50, activeSellerCount: 50, sellerConcentration: 0.05,
      topSellerDominance: 0.1, priceDispersion: 0.15, lowestPrice: 95000,
      competitionScore: 0.8, competitionLevel: 'EXTREME', priceWarRisk: 'HIGH',
      priceWarProbability: 0.7, marketSaturationScore: 0.7, priceStability: 0.85,
      evidence: [], methodology: 'test', timestamp: new Date().toISOString(),
    };
    const result = assessComprehensiveRisk({
      product: makeProduct(), supplier: makeSupplier(), economics: makeEconomics(),
      demand: null, competition, decay: null, marketplace: 'shopee', requestId: 'req_test',
    });
    const compRisk = result.dimensions.find((d) => d.name === 'competition_risk')!;
    expect(compRisk.score).toBeGreaterThan(0.4);
  });
});
