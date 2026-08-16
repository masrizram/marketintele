import { SupplierSourcingService } from './supplier-sourcing-service';
import { TestFixtureSupplierAdapter } from './test-fixture-supplier-adapter';
import { SupplierAdapter, SupplierOffer, SupplierSourceEntity } from './supplier-adapter';
import { CanonicalProduct } from '../types';

function makeProduct(): CanonicalProduct {
  return {
    id: 'prod_001', canonicalTitle: 'Power Bank', brand: 'Brand', model: 'M',
    categoryId: null, standardUnit: 'pcs', standardWeightGrams: null,
    standardDimensionsCm: null, sku: 'SKU', barcode: '8888',
    priceInIdr: 100000, currencyConverted: false, moq: 1, packageQuantity: 1,
    packageUnit: 'pcs', sourceId: 'src', supplierProductId: null,
    marketplaceListingId: null, sellerId: 's1', sellerName: 'Seller',
    marketplaceListingUrl: 'https://example.com/p',
    observedAt: new Date().toISOString(), confidence: 0.8,
    dataLineage: { sourceId: 'src', rawDocumentId: 'doc', rawEvidenceHash: 'hash',
      extractionMethod: 'test', observedAt: new Date().toISOString(), confidence: 0.8,
      evidenceHierarchyLevel: 3 },
  };
}

describe('SupplierSourcingService — no adapter (fail-closed)', () => {
  it('returns null when no adapter registered', async () => {
    const svc = new SupplierSourcingService();
    const result = await svc.searchSuppliers('power bank', makeProduct());
    expect(result.supplier).toBeNull();
    expect(result.offers.length).toBe(0);
    expect(result.dataProvenance).toBe('NONE');
  });

  it('hasRealAdapters returns false when empty', () => {
    const svc = new SupplierSourcingService();
    expect(svc.hasRealAdapters()).toBe(false);
  });
});

describe('SupplierSourcingService — with TEST_FIXTURE adapter', () => {
  it('sources supplier from fixture adapter', async () => {
    const svc = new SupplierSourcingService();
    svc.registerAdapter(new TestFixtureSupplierAdapter());
    const result = await svc.searchSuppliers('power bank', makeProduct());
    expect(result.supplier).not.toBeNull();
    expect(result.supplier!.sourcePriceIdr).not.toBeNull();
    expect(result.supplier!.sourcePriceIdr).toBeLessThan(100000); // below retail
    expect(result.dataProvenance).toBe('TEST_FIXTURE');
    expect(result.usedRealAdapter).toBe(false);
  });

  it('reports TEST_FIXTURE provenance', async () => {
    const svc = new SupplierSourcingService();
    svc.registerAdapter(new TestFixtureSupplierAdapter());
    const result = await svc.searchSuppliers('power bank', makeProduct());
    expect(result.dataProvenance).toBe('TEST_FIXTURE');
  });
});

describe('SupplierSourcingService — adapter failure (graceful)', () => {
  it('continues when adapter throws — does NOT fabricate supplier', async () => {
    const failingAdapter: SupplierAdapter = {
      adapterName: 'FailingAdapter',
      sourceName: 'Failing Source',
      dataProvenance: 'REAL',
      async searchSuppliers(): Promise<SupplierOffer[]> {
        throw new Error('API timeout');
      },
      async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; },
    };
    const svc = new SupplierSourcingService();
    svc.registerAdapter(failingAdapter);
    const result = await svc.searchSuppliers('query', makeProduct());
    // Should return null — no fabricated supplier to compensate for failure
    expect(result.supplier).toBeNull();
    expect(result.reason).toContain('zero offers');
  });
});

describe('SupplierSourcingService — selects best offer by match confidence', () => {
  it('returns the offer with highest match confidence', async () => {
    const lowConfidence: SupplierAdapter = {
      adapterName: 'LowConf', sourceName: 'Low', dataProvenance: 'REAL',
      async searchSuppliers(): Promise<SupplierOffer[]> {
        return [{
          supplier: { supplierId: 'low', supplierName: 'Low', supplierType: 'MANUFACTURER',
            legalName: null, website: null, domain: null, country: null, province: null,
            city: null, address: null, phone: null, email: null, catalogUrl: null, sourceUrls: [],
            verificationStatus: 'UNKNOWN', supplierScore: 0.3, supplierConfidence: 0.3,
            firstSeenAt: new Date().toISOString(), lastVerifiedAt: null, dataProvenance: 'REAL', evidence: [] },
          pricing: { unitPriceIdr: 50000, currency: 'IDR', moq: 10, priceTiers: null,
            taxIncluded: false, shippingIncluded: false, leadTimeDays: 7, stock: 100,
            paymentTerms: null, validUntil: null, dataProvenance: 'REAL', evidence: [] },
          matchConfidence: 0.5, evidence: [],
        }];
      },
      async verifySupplier(s) { return s; },
    };
    const highConfidence: SupplierAdapter = {
      adapterName: 'HighConf', sourceName: 'High', dataProvenance: 'REAL',
      async searchSuppliers(): Promise<SupplierOffer[]> {
        return [{
          supplier: { supplierId: 'high', supplierName: 'High', supplierType: 'MANUFACTURER',
            legalName: null, website: null, domain: null, country: null, province: null,
            city: null, address: null, phone: null, email: null, catalogUrl: null, sourceUrls: [],
            verificationStatus: 'VERIFIED', supplierScore: 0.9, supplierConfidence: 0.9,
            firstSeenAt: new Date().toISOString(), lastVerifiedAt: null, dataProvenance: 'REAL', evidence: [] },
          pricing: { unitPriceIdr: 45000, currency: 'IDR', moq: 20, priceTiers: null,
            taxIncluded: false, shippingIncluded: false, leadTimeDays: 5, stock: 200,
            paymentTerms: null, validUntil: null, dataProvenance: 'REAL', evidence: [] },
          matchConfidence: 0.9, evidence: [],
        }];
      },
      async verifySupplier(s) { return s; },
    };
    const svc = new SupplierSourcingService();
    svc.registerAdapter(lowConfidence);
    svc.registerAdapter(highConfidence);
    const result = await svc.searchSuppliers('query', makeProduct());
    expect(result.supplier).not.toBeNull();
    expect(result.supplier!.id).toBe('high'); // higher confidence
    expect(result.usedRealAdapter).toBe(true);
  });
});
