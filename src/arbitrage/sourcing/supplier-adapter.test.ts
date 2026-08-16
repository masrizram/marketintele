import { offerToSupplierSource, SupplierSourceEntity, SupplierOffer } from './supplier-adapter';
import { TestFixtureSupplierAdapter } from './test-fixture-supplier-adapter';
import { CanonicalProduct } from '../types';

function makeProduct(priceInIdr: number | null = 100000): CanonicalProduct {
  return {
    id: 'prod_test_001',
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

describe('Supplier Adapter — offerToSupplierSource (IDEA §10)', () => {
  it('converts an offer to pipeline SupplierSource preserving UNKNOWN fields', () => {
    const supplier: SupplierSourceEntity = {
      supplierId: 'sup_001',
      supplierName: 'Factory Co',
      supplierType: 'MANUFACTURER',
      legalName: 'Factory Co Ltd',
      website: 'https://factory.example.com',
      domain: 'factory.example.com',
      country: 'China',
      province: 'Guangdong',
      city: 'Shenzhen',
      address: null,
      phone: null,
      email: 'sales@factory.example.com',
      catalogUrl: null,
      sourceUrls: ['https://factory.example.com/catalog'],
      verificationStatus: 'PARTIALLY_VERIFIED',
      supplierScore: 0.6,
      supplierConfidence: 0.5,
      firstSeenAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      dataProvenance: 'TEST_FIXTURE',
      evidence: ['test evidence'],
    };
    const offer: SupplierOffer = {
      supplier,
      pricing: {
        unitPriceIdr: 40000,
        currency: 'IDR',
        moq: 50,
        priceTiers: null,
        taxIncluded: false,
        shippingIncluded: false,
        leadTimeDays: 14,
        stock: 500,
        paymentTerms: '30% deposit',
        validUntil: null,
        dataProvenance: 'TEST_FIXTURE',
        evidence: ['test pricing'],
      },
      matchConfidence: 0.7,
      evidence: ['match evidence'],
    };
    const result = offerToSupplierSource(offer);
    expect(result.id).toBe('sup_001');
    expect(result.name).toBe('Factory Co');
    expect(result.type).toBe('MANUFACTURER');
    expect(result.sourcePriceIdr).toBe(40000);
    expect(result.moq).toBe(50);
    expect(result.shippingCostIdr).toBeNull(); // shipping not in pricing
    expect(result.confidence).toBe('PARTIALLY_VERIFIED');
  });

  it('preserves UNKNOWN supplier price (null stays null)', () => {
    const supplier: SupplierSourceEntity = {
      supplierId: 'sup_002',
      supplierName: 'Unknown Supplier',
      supplierType: 'UNKNOWN',
      legalName: null, website: null, domain: null,
      country: null, province: null, city: null, address: null,
      phone: null, email: null, catalogUrl: null, sourceUrls: [],
      verificationStatus: 'UNKNOWN',
      supplierScore: 0, supplierConfidence: 0,
      firstSeenAt: new Date().toISOString(), lastVerifiedAt: null,
      dataProvenance: 'TEST_FIXTURE', evidence: [],
    };
    const offer: SupplierOffer = {
      supplier,
      pricing: {
        unitPriceIdr: null, currency: 'IDR', moq: null, priceTiers: null,
        taxIncluded: false, shippingIncluded: false, leadTimeDays: null,
        stock: null, paymentTerms: null, validUntil: null,
        dataProvenance: 'TEST_FIXTURE', evidence: [],
      },
      matchConfidence: 0, evidence: [],
    };
    const result = offerToSupplierSource(offer);
    expect(result.sourcePriceIdr).toBeNull();
    expect(result.moq).toBeNull();
    expect(result.shippingCostIdr).toBeNull();
    expect(result.confidence).toBe('UNKNOWN');
  });

  it('maps verification status to confidence tier correctly', () => {
    const baseSupplier: SupplierSourceEntity = {
      supplierId: 's', supplierName: 'S', supplierType: 'FACTORY',
      legalName: null, website: null, domain: null, country: null,
      province: null, city: null, address: null, phone: null, email: null,
      catalogUrl: null, sourceUrls: [], verificationStatus: 'VERIFIED',
      supplierScore: 0.8, supplierConfidence: 0.8,
      firstSeenAt: new Date().toISOString(), lastVerifiedAt: null,
      dataProvenance: 'TEST_FIXTURE', evidence: [],
    };
    const basePricing = {
      unitPriceIdr: 10000, currency: 'IDR', moq: 10, priceTiers: null,
      taxIncluded: false, shippingIncluded: false, leadTimeDays: 7,
      stock: 100, paymentTerms: null, validUntil: null,
      dataProvenance: 'TEST_FIXTURE' as const, evidence: [],
    };

    for (const status of ['HIGH_CONFIDENCE', 'VERIFIED'] as const) {
      const r = offerToSupplierSource({ supplier: { ...baseSupplier, verificationStatus: status }, pricing: basePricing, matchConfidence: 0.8, evidence: [] });
      expect(r.confidence).toBe('VERIFIED');
    }
    const r2 = offerToSupplierSource({ supplier: { ...baseSupplier, verificationStatus: 'PARTIALLY_VERIFIED' }, pricing: basePricing, matchConfidence: 0.8, evidence: [] });
    expect(r2.confidence).toBe('PARTIALLY_VERIFIED');
    for (const status of ['UNVERIFIED', 'SUSPICIOUS', 'UNKNOWN'] as const) {
      const r = offerToSupplierSource({ supplier: { ...baseSupplier, verificationStatus: status }, pricing: basePricing, matchConfidence: 0.8, evidence: [] });
      expect(r.confidence).toBe('UNKNOWN');
    }
  });
});

describe('TEST_FIXTURE Supplier Adapter (IDEA §58)', () => {
  it('explicitly marks dataProvenance as TEST_FIXTURE', () => {
    const adapter = new TestFixtureSupplierAdapter();
    expect(adapter.dataProvenance).toBe('TEST_FIXTURE');
    expect(adapter.adapterName).toContain('TestFixture');
  });

  it('returns a fixture offer with wholesale price below retail', async () => {
    const adapter = new TestFixtureSupplierAdapter();
    const product = makeProduct(100000);
    const offers = await adapter.searchSuppliers('power bank', product);
    expect(offers.length).toBe(1);
    const offer = offers[0];
    expect(offer.supplier.dataProvenance).toBe('TEST_FIXTURE');
    expect(offer.pricing.dataProvenance).toBe('TEST_FIXTURE');
    expect(offer.pricing.unitPriceIdr).not.toBeNull();
    expect(offer.pricing.unitPriceIdr!).toBeLessThan(100000); // below retail
    expect(offer.pricing.moq).toBe(50);
    expect(offer.evidence.some((e) => e.includes('TEST_FIXTURE'))).toBe(true);
  });

  it('returns empty offers when product price is null', async () => {
    const adapter = new TestFixtureSupplierAdapter();
    const product = makeProduct(null);
    const offers = await adapter.searchSuppliers('power bank', product);
    expect(offers.length).toBe(0);
  });

  it('provides price tiers', async () => {
    const adapter = new TestFixtureSupplierAdapter();
    const product = makeProduct(100000);
    const offers = await adapter.searchSuppliers('power bank', product);
    expect(offers[0].pricing.priceTiers).not.toBeNull();
    expect(offers[0].pricing.priceTiers!.length).toBe(3);
    // Tier 3 (100+) should be cheaper than Tier 1 (1-9)
    const t1 = offers[0].pricing.priceTiers![0];
    const t3 = offers[0].pricing.priceTiers![2];
    expect(t3.unitPriceIdr).toBeLessThan(t1.unitPriceIdr);
  });

  it('verifySupplier stamps TEST_FIXTURE evidence', async () => {
    const adapter = new TestFixtureSupplierAdapter();
    const supplier: SupplierSourceEntity = {
      supplierId: 's1', supplierName: 'Test', supplierType: 'MANUFACTURER',
      legalName: null, website: null, domain: null, country: null,
      province: null, city: null, address: null, phone: null, email: null,
      catalogUrl: null, sourceUrls: [], verificationStatus: 'UNVERIFIED',
      supplierScore: 0, supplierConfidence: 0,
      firstSeenAt: new Date().toISOString(), lastVerifiedAt: null,
      dataProvenance: 'TEST_FIXTURE', evidence: ['existing evidence'],
    };
    const verified = await adapter.verifySupplier(supplier);
    expect(verified.verificationStatus).toBe('PARTIALLY_VERIFIED');
    expect(verified.evidence.some((e) => e.includes('TEST_FIXTURE'))).toBe(true);
  });

  it('healthCheck returns true (fixture always healthy)', async () => {
    const adapter = new TestFixtureSupplierAdapter();
    expect(await adapter.healthCheck()).toBe(true);
  });
});
