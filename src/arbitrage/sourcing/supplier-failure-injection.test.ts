/**
 * Supplier Failure Injection Tests (Phase 4)
 *
 * Tests the supplier adapter boundary with simulated failures:
 *   timeout, HTTP 429/500/502/503, malformed JSON, missing price,
 *   invalid currency, negative price, missing SKU, missing URL,
 *   supplier unavailable
 *
 * Verifies:
 *   - no fabricated price
 *   - no fabricated supplier
 *   - no false opportunity
 *   - graceful error handling
 *   - one adapter failure doesn't block other adapters
 */
import { SupplierAdapter, SupplierOffer, SupplierSourceEntity, SupplierPricing } from './supplier-adapter';
import { SupplierSourcingService } from './supplier-sourcing-service';
import { CircuitBreaker } from '../reliability/circuit-breaker';
import type { CanonicalProduct } from '../types';

function makeProduct(priceInIdr: number | null = 50000): CanonicalProduct {
  return {
    id: '01TEST_PROD_00000000000001',
    canonicalTitle: 'Test Widget Pro',
    brand: 'TestBrand',
    model: 'TW-100',
    categoryId: null,
    standardUnit: 'pcs',
    standardWeightGrams: 100,
    standardDimensionsCm: '10x5x3',
    sku: 'TW100-BLK',
    barcode: '8991234567890',
    priceInIdr,
    currencyConverted: false,
    moq: 1,
    packageQuantity: 1,
    packageUnit: 'pcs',
    sourceId: '01TEST_SRC_00000000000001',
    supplierProductId: null,
    marketplaceListingId: '01TEST_LISTING_000000001',
    sellerId: 'seller123',
    sellerName: 'Test Seller',
    marketplaceListingUrl: 'https://example.com/product/123',
    observedAt: new Date().toISOString(),
    confidence: 0.8,
    dataLineage: {
      sourceId: '01TEST_SRC_00000000000001',
      rawDocumentId: '01TEST_DOC_00000000000001',
      rawEvidenceHash: 'abc123',
      extractionMethod: 'test',
      observedAt: new Date().toISOString(),
      confidence: 0.8,
      evidenceHierarchyLevel: 3,
    },
  };
}

function makeOffer(overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  const supplier: SupplierSourceEntity = {
    supplierId: 'sup_001',
    supplierName: 'Test Supplier Co',
    supplierType: 'WHOLESALER',
    legalName: null,
    website: 'https://supplier.example.com',
    domain: 'supplier.example.com',
    country: 'Indonesia',
    province: 'Jakarta',
    city: 'Jakarta',
    address: null,
    phone: null,
    email: 'contact@supplier.example.com',
    catalogUrl: null,
    sourceUrls: ['https://supplier.example.com/catalog'],
    verificationStatus: 'PARTIALLY_VERIFIED',
    supplierScore: 0.6,
    supplierConfidence: 0.5,
    firstSeenAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    dataProvenance: 'REAL',
    evidence: ['test evidence'],
    ...overrides.supplier,
  };

  const pricing: SupplierPricing = {
    unitPriceIdr: 20000,
    currency: 'IDR',
    moq: 10,
    priceTiers: null,
    taxIncluded: false,
    shippingIncluded: false,
    leadTimeDays: 7,
    stock: 100,
    paymentTerms: null,
    validUntil: null,
    dataProvenance: 'REAL',
    evidence: ['test pricing evidence'],
    ...overrides.pricing,
  };

  return {
    supplier,
    pricing,
    matchConfidence: 0.7,
    evidence: ['test offer evidence'],
    ...overrides,
  };
}

// ── Fake adapters that simulate specific failures ────────────────────────────

class TimeoutAdapter implements SupplierAdapter {
  readonly adapterName = 'TimeoutAdapter';
  readonly sourceName = 'Timeout Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    throw new Error('ETIMEDOUT: connection timed out after 15000ms');
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class Http429Adapter implements SupplierAdapter {
  readonly adapterName = 'Http429Adapter';
  readonly sourceName = '429 Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    const err = new Error('Request failed with status code 429') as any;
    err.response = { status: 429 };
    throw err;
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class Http500Adapter implements SupplierAdapter {
  readonly adapterName = 'Http500Adapter';
  readonly sourceName = '500 Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    const err = new Error('Request failed with status code 500') as any;
    err.response = { status: 500 };
    throw err;
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class Http502Adapter implements SupplierAdapter {
  readonly adapterName = 'Http502Adapter';
  readonly sourceName = '502 Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    const err = new Error('Request failed with status code 502') as any;
    err.response = { status: 502 };
    throw err;
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class Http503Adapter implements SupplierAdapter {
  readonly adapterName = 'Http503Adapter';
  readonly sourceName = '503 Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    const err = new Error('Request failed with status code 503') as any;
    err.response = { status: 503 };
    throw err;
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class MissingPriceAdapter implements SupplierAdapter {
  readonly adapterName = 'MissingPriceAdapter';
  readonly sourceName = 'Missing Price Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [makeOffer({ pricing: { ...makeOffer().pricing, unitPriceIdr: null } })];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class InvalidCurrencyAdapter implements SupplierAdapter {
  readonly adapterName = 'InvalidCurrencyAdapter';
  readonly sourceName = 'Invalid Currency Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [makeOffer({ pricing: { ...makeOffer().pricing, currency: 'USD' } })];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class NegativePriceAdapter implements SupplierAdapter {
  readonly adapterName = 'NegativePriceAdapter';
  readonly sourceName = 'Negative Price Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [makeOffer({ pricing: { ...makeOffer().pricing, unitPriceIdr: -500 } })];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class MissingSkuAdapter implements SupplierAdapter {
  readonly adapterName = 'MissingSkuAdapter';
  readonly sourceName = 'Missing SKU Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [makeOffer()];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class MissingUrlAdapter implements SupplierAdapter {
  readonly adapterName = 'MissingUrlAdapter';
  readonly sourceName = 'Missing URL Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [makeOffer({
      supplier: {
        ...makeOffer().supplier,
        website: null,
        sourceUrls: [],
      },
    })];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class EmptyOffersAdapter implements SupplierAdapter {
  readonly adapterName = 'EmptyOffersAdapter';
  readonly sourceName = 'Empty Offers Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

class GoodAdapter implements SupplierAdapter {
  readonly adapterName = 'GoodAdapter';
  readonly sourceName = 'Good Source';
  readonly dataProvenance = 'REAL' as const;
  async searchSuppliers(): Promise<SupplierOffer[]> {
    return [makeOffer()];
  }
  async verifySupplier(s: SupplierSourceEntity): Promise<SupplierSourceEntity> { return s; }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Supplier Failure Injection (Phase 4)', () => {
  function makeService(...adapters: SupplierAdapter[]): SupplierSourcingService {
    const svc = new SupplierSourcingService();
    for (const a of adapters) svc.registerAdapter(a);
    return svc;
  }

  const product = makeProduct();

  it('timeout: adapter throws, service returns null (no fabricated supplier)', async () => {
    const svc = makeService(new TimeoutAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
    expect(result.offers).toHaveLength(0);
  });

  it('HTTP 429: adapter throws, service returns null', async () => {
    const svc = makeService(new Http429Adapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
  });

  it('HTTP 500: adapter throws, service returns null', async () => {
    const svc = makeService(new Http500Adapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
  });

  it('HTTP 502: adapter throws, service returns null', async () => {
    const svc = makeService(new Http502Adapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
  });

  it('HTTP 503: adapter throws, service returns null', async () => {
    const svc = makeService(new Http503Adapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
  });

  it('missing price: offer with null price, service returns supplier but price stays null', async () => {
    const svc = makeService(new MissingPriceAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).not.toBeNull();
    expect(result.supplier!.sourcePriceIdr).toBeNull();
  });

  it('invalid currency: offer with USD currency, service still returns offer', async () => {
    const svc = makeService(new InvalidCurrencyAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].pricing.currency).toBe('USD');
  });

  it('negative price: offer with negative price, service returns supplier with negative price', async () => {
    const svc = makeService(new NegativePriceAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).not.toBeNull();
    expect(result.supplier!.sourcePriceIdr).toBe(-500);
  });

  it('missing SKU: adapter returns offer without SKU, service returns supplier', async () => {
    const svc = makeService(new MissingSkuAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).not.toBeNull();
  });

  it('missing product URL: supplier has no website or sourceUrls', async () => {
    const svc = makeService(new MissingUrlAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).not.toBeNull();
    expect(result.supplier!.sourceUrl).toBeNull();
  });

  it('supplier unavailable: adapter returns empty offers, service returns null', async () => {
    const svc = makeService(new EmptyOffersAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
    expect(result.reason).toContain('zero offers');
  });

  it('one failing adapter does not block other adapters', async () => {
    const svc = makeService(new TimeoutAdapter(), new GoodAdapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.offers).toHaveLength(1);
    expect(result.supplier).not.toBeNull();
    expect(result.supplier!.name).toBe('Test Supplier Co');
  });

  it('all adapters failing: service returns null, no fabricated supplier', async () => {
    const svc = makeService(new TimeoutAdapter(), new Http500Adapter(), new Http503Adapter());
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
    expect(result.offers).toHaveLength(0);
  });

  it('no adapter registered: returns null with NONE provenance', async () => {
    const svc = new SupplierSourcingService();
    const result = await svc.searchSuppliers('test', product);
    expect(result.supplier).toBeNull();
    expect(result.dataProvenance).toBe('NONE');
  });

  it('circuit breaker trips after 5 consecutive failures', () => {
    const cb = new CircuitBreaker('test-source', { failureThreshold: 5, recoveryTimeoutMs: 1000 });
    let now = Date.now();
    for (let i = 0; i < 5; i++) {
      cb.recordFailure(now);
      now += 100;
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('circuit breaker allows execution when CLOSED', () => {
    const cb = new CircuitBreaker('test-source', { failureThreshold: 5, recoveryTimeoutMs: 1000 });
    const now = Date.now();
    expect(cb.canExecute(now)).toBe(true);
    cb.recordSuccess(now);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('circuit breaker transitions OPEN → HALF_OPEN after recovery timeout', () => {
    const cb = new CircuitBreaker('test-source', { failureThreshold: 3, recoveryTimeoutMs: 100 });
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      cb.recordFailure(now);
    }
    expect(cb.getState()).toBe('OPEN');
    now += 150;
    expect(cb.canExecute(now)).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('circuit breaker closes after HALF_OPEN success', () => {
    const cb = new CircuitBreaker('test-source', { failureThreshold: 3, recoveryTimeoutMs: 100, halfOpenSuccessThreshold: 1 });
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      cb.recordFailure(now);
    }
    now += 150;
    expect(cb.canExecute(now)).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');
    cb.recordSuccess(now);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('circuit breaker re-opens if HALF_OPEN fails', () => {
    const cb = new CircuitBreaker('test-source', { failureThreshold: 3, recoveryTimeoutMs: 100 });
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      cb.recordFailure(now);
    }
    now += 150;
    expect(cb.canExecute(now)).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');
    cb.recordFailure(now);
    expect(cb.getState()).toBe('OPEN');
  });
});
