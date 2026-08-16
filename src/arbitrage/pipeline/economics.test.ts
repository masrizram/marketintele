import { computeEconomics } from './economics';
import { CanonicalProduct } from '../types';

function makeProduct(priceInIdr: number | null = 100000): CanonicalProduct {
  return {
    id: 'prod_001',
    canonicalTitle: 'Power Bank 10000mAh',
    brand: 'TechBrand',
    model: 'PB-10K',
    categoryId: null,
    standardUnit: 'pcs',
    standardWeightGrams: null,
    standardDimensionsCm: null,
    sku: 'PB-10K-PD30W',
    barcode: '8888123456789',
    priceInIdr,
    currencyConverted: false,
    moq: 1,
    packageQuantity: 1,
    packageUnit: 'pcs',
    sourceId: 'src_001',
    supplierProductId: null,
    marketplaceListingId: null,
    sellerId: 'seller_123',
    sellerName: 'TestSeller',
    marketplaceListingUrl: 'https://shopee.co.id/product-123',
    observedAt: new Date().toISOString(),
    confidence: 0.85,
    dataLineage: {
      sourceId: 'src_001',
      rawDocumentId: 'doc_001',
      rawEvidenceHash: 'abc123',
      extractionMethod: 'test',
      observedAt: new Date().toISOString(),
      confidence: 0.85,
      evidenceHierarchyLevel: 3,
    },
  };
}

describe('Economics — UNKNOWN supplier cost (IDEA §7.1)', () => {
  it('returns supplierBaseCost = null when supplier price is null (UNKNOWN != ZERO)', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, null, null, null, 'req_test',
    );
    expect(result.supplierBaseCost).toBeNull();
    expect(result.landedCost).toBeNull();
    expect(result.profitCalculation).toBeNull();
    expect(result.profitError).toContain('UNKNOWN');
  });

  it('returns supplierBaseCost = null when supplier price is 0', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, 0, null, null, 'req_test',
    );
    expect(result.supplierBaseCost).toBeNull();
    expect(result.landedCost).toBeNull();
  });

  it('returns supplierBaseCost = null when supplier price is negative', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, -50000, null, null, 'req_test',
    );
    expect(result.supplierBaseCost).toBeNull();
  });
});

describe('Economics — with valid supplier cost + shipping', () => {
  it('computes landed cost when supplier cost and shipping are provided', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.supplierBaseCost).toBe(40000);
    expect(result.landedCost).not.toBeNull();
    expect(result.landedCost).toBeGreaterThan(40000); // supplier + taxes + fees
    expect(result.landedCostBreakdown).not.toBeNull();
    expect(result.landedCostBreakdown!.supplierBaseCost).toBe(40000);
    expect(result.landedCostBreakdown!.inboundLogistics).toBe(10000);
  });

  it('fails closed when shipping is null (UNKNOWN shipping != 0)', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, 40000, 50, null, 'req_test',
    );
    // Landed cost should be null because inboundLogistics is null
    expect(result.landedCost).toBeNull();
    expect(result.profitError).toContain('Landed cost incomplete');
  });

  it('computes marketplace fee from fee config', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.marketplaceFee).not.toBeNull();
    expect(result.marketplaceFee).toBeGreaterThan(0);
    expect(result.feeConfigUsed).not.toBeNull();
    expect(result.feeConfigUsed!.marketplace).toBe('shopee');
  });

  it('computes profit with independent validation when all inputs provided', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.profitCalculation).not.toBeNull();
    expect(result.profitCalculation!.independentValidation).toBe(true);
    expect(result.profitCalculation!.reconciled).toBe(true);
  });

  it('uses conservative clearing price as selling price when provided', () => {
    // sellingPriceIdr parameter IS the clearing price (pipeline passes it)
    const result = computeEconomics(
      makeProduct(249999), 'shopee', 80000, 40000, 50, 10000, 'req_test',
    );
    // Selling price = 80000 (conservative), not 249999 (listing)
    expect(result.sellingPriceIdr).toBe(80000);
    expect(result.landedCost).not.toBeNull();
  });
});

describe('Economics — fee config for different marketplaces', () => {
  it('returns unconfirmed config for unknown marketplace', () => {
    const result = computeEconomics(
      makeProduct(100000), 'unknown_marketplace', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.feeConfigUsed).not.toBeNull();
    expect(result.feeConfigUsed!.marketplace).toBe('unknown_marketplace');
    // Unconfirmed config has all nulls → marketplaceFee will be null
    expect(result.marketplaceFee).toBeNull();
  });

  it('computes fee for tokopedia', () => {
    const result = computeEconomics(
      makeProduct(100000), 'tokopedia', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.marketplaceFee).not.toBeNull();
    expect(result.feeConfigUsed!.marketplace).toBe('tokopedia');
  });

  it('computes fee for lazada', () => {
    const result = computeEconomics(
      makeProduct(100000), 'lazada', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.marketplaceFee).not.toBeNull();
  });

  it('computes fee for blibli', () => {
    const result = computeEconomics(
      makeProduct(100000), 'blibli', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.marketplaceFee).not.toBeNull();
  });

  it('computes fee for tiktok_shop', () => {
    const result = computeEconomics(
      makeProduct(100000), 'tiktok_shop', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.marketplaceFee).not.toBeNull();
  });
});

describe('Economics — adversarial cases', () => {
  it('handles zero selling price', () => {
    const result = computeEconomics(
      makeProduct(0), 'shopee', 0, 40000, 50, 10000, 'req_test',
    );
    // With selling price 0, marketplace fee = 0 but profit will be very negative
    expect(result.marketplaceFee).not.toBeNull();
  });

  it('handles negative selling price', () => {
    const result = computeEconomics(
      makeProduct(-1000), 'shopee', -1000, 40000, 50, 10000, 'req_test',
    );
    expect(result.profitCalculation).not.toBeNull();
    expect(result.profitCalculation!.primaryResult.netProfitPerUnit.toNumber()).toBeLessThan(0);
  });

  it('breakdown shows all cost components with provenance', () => {
    const result = computeEconomics(
      makeProduct(100000), 'shopee', 100000, 40000, 50, 10000, 'req_test',
    );
    expect(result.landedCostBreakdown).not.toBeNull();
    const bd = result.landedCostBreakdown!;
    expect(bd).toHaveProperty('supplierBaseCost');
    expect(bd).toHaveProperty('inboundLogistics');
    expect(bd).toHaveProperty('valueAddedTax');
    expect(bd).toHaveProperty('customsClearance');
    expect(bd).toHaveProperty('totalLandedCost');
  });
});
