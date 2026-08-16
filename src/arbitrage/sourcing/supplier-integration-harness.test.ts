/**
 * Supplier Integration Harness Tests (Phase 2)
 *
 * Tests the credential validation and integration harness.
 * Verifies that:
 *   - When no credentials are available: realSupplierRuntimePossible = false
 *   - When credentials ARE available: realSupplierRuntimePossible = true
 *   - The harness correctly throws when credentials are missing
 *   - The adapter contract is complete
 *   - TEST_FIXTURE is preserved as a test-only implementation
 *
 * Real supplier runtime is classified as NOT_TESTED when no credentials
 * are available — this is the correct, honest classification.
 */
import {
  validateSupplierCredentials,
  SupplierIntegrationHarness,
  REQUIRED_SUPPLIER_CREDENTIALS,
} from './supplier-integration-harness';
import { TestFixtureSupplierAdapter } from './test-fixture-supplier-adapter';
import { CanonicalProduct } from '../types';

function makeProduct(): CanonicalProduct {
  return {
    id: '01TEST_PROD_00000000000001',
    canonicalTitle: 'Test Widget',
    brand: 'TestBrand',
    model: 'TW-100',
    categoryId: null,
    standardUnit: 'pcs',
    standardWeightGrams: 100,
    standardDimensionsCm: '10x5x3',
    sku: 'TW100',
    barcode: '8991234567890',
    priceInIdr: 50000,
    currencyConverted: false,
    moq: 1,
    packageQuantity: 1,
    packageUnit: 'pcs',
    sourceId: 'test',
    supplierProductId: null,
    marketplaceListingId: null,
    sellerId: 'seller1',
    sellerName: 'Seller',
    marketplaceListingUrl: 'https://example.com/p',
    observedAt: new Date().toISOString(),
    confidence: 0.8,
    dataLineage: {
      sourceId: 'test',
      rawDocumentId: 'doc1',
      rawEvidenceHash: 'abc',
      extractionMethod: 'test',
      observedAt: new Date().toISOString(),
      confidence: 0.8,
      evidenceHierarchyLevel: 3,
    },
  };
}

describe('Supplier Credential Validation (Phase 2)', () => {
  it('validateSupplierCredentials returns result object', () => {
    const result = validateSupplierCredentials();
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
    expect(['CREDENTIALS_AVAILABLE', 'NO_CREDENTIALS']).toContain(result.status);
  });

  it('validateSupplierCredentials lists all required credential env vars', () => {
    expect(REQUIRED_SUPPLIER_CREDENTIALS.length).toBeGreaterThan(0);
    for (const cred of REQUIRED_SUPPLIER_CREDENTIALS) {
      expect(cred.envVar).toBeDefined();
      expect(cred.description).toBeDefined();
    }
  });

  it('validateSupplierCredentials detects placeholder values as missing', () => {
    const oldEnv = { ...process.env };
    process.env.ALIBABA_API_KEY = 'YOUR_KEY_HERE';
    const result = validateSupplierCredentials();
    expect(result.availableCredentials).not.toContain('ALIBABA_API_KEY');
    process.env = oldEnv;
  });

  it('validateSupplierCredentials detects real values as available', () => {
    const oldEnv = process.env.ALIBABA_API_KEY;
    process.env.ALIBABA_API_KEY = 'real_api_key_12345';
    const result = validateSupplierCredentials();
    expect(result.availableCredentials).toContain('ALIBABA_API_KEY');
    expect(result.realSupplierRuntimePossible).toBe(true);
    if (oldEnv === undefined) {
      delete process.env.ALIBABA_API_KEY;
    } else {
      process.env.ALIBABA_API_KEY = oldEnv;
    }
  });
});

describe('Supplier Integration Harness (Phase 2)', () => {
  const fixture = new TestFixtureSupplierAdapter();
  const harness = new SupplierIntegrationHarness(fixture);
  const product = makeProduct();

  it('harness throws when credentials are not available', async () => {
    const oldEnv = { ...process.env };
    // Clear all supplier credentials
    for (const cred of REQUIRED_SUPPLIER_CREDENTIALS) {
      delete process.env[cred.envVar];
    }
    await expect(harness.searchSuppliers('test', product)).rejects.toThrow(/Cannot run real supplier/);
    process.env = oldEnv;
  });

  it('TEST_FIXTURE adapter is explicitly marked as TEST_FIXTURE', () => {
    expect(fixture.dataProvenance).toBe('TEST_FIXTURE');
    expect(fixture.adapterName).toContain('TestFixture');
  });

  it('TEST_FIXTURE adapter produces offers with TEST_FIXTURE provenance', async () => {
    const offers = await fixture.searchSuppliers('test', product);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.supplier.dataProvenance).toBe('TEST_FIXTURE');
      expect(offer.pricing.dataProvenance).toBe('TEST_FIXTURE');
      expect(offer.evidence.some((e) => e.includes('TEST_FIXTURE'))).toBe(true);
    }
  });

  it('TEST_FIXTURE adapter returns empty when product has no price', async () => {
    const noPriceProduct = { ...product, priceInIdr: null };
    const offers = await fixture.searchSuppliers('test', noPriceProduct);
    expect(offers).toHaveLength(0);
  });
});

describe('Supplier Adapter Contract (Phase 2)', () => {
  it('SupplierAdapter interface requires searchSuppliers method', () => {
    const fixture = new TestFixtureSupplierAdapter();
    expect(typeof fixture.searchSuppliers).toBe('function');
  });

  it('SupplierAdapter interface requires verifySupplier method', () => {
    const fixture = new TestFixtureSupplierAdapter();
    expect(typeof fixture.verifySupplier).toBe('function');
  });

  it('SupplierAdapter has adapterName and sourceName', () => {
    const fixture = new TestFixtureSupplierAdapter();
    expect(fixture.adapterName).toBeDefined();
    expect(fixture.sourceName).toBeDefined();
  });

  it('SupplierAdapter has dataProvenance field', () => {
    const fixture = new TestFixtureSupplierAdapter();
    expect(['REAL', 'TEST_FIXTURE', 'MOCK']).toContain(fixture.dataProvenance);
  });

  it('SupplierOffer includes all required fields', async () => {
    const fixture = new TestFixtureSupplierAdapter();
    const product = makeProduct();
    const offers = await fixture.searchSuppliers('test', product);
    const offer = offers[0];

    expect(offer.supplier).toBeDefined();
    expect(offer.pricing).toBeDefined();
    expect(offer.matchConfidence).toBeDefined();
    expect(offer.evidence).toBeDefined();
    expect(offer.supplier.supplierId).toBeDefined();
    expect(offer.supplier.supplierName).toBeDefined();
    expect(offer.supplier.supplierType).toBeDefined();
    expect(offer.supplier.verificationStatus).toBeDefined();
    expect(offer.pricing.unitPriceIdr).toBeDefined();
    expect(offer.pricing.currency).toBeDefined();
    expect(offer.pricing.moq).toBeDefined();
  });
});
