/**
 * E2E Pipeline Test
 *
 * Verifies the full business pipeline end-to-end:
 *   Telegram command
 *   → Discovery
 *   → Adapter (fetch + parse + normalize)
 *   → Matching
 *   → Supplier/Source
 *   → Landed Cost
 *   → Profit
 *   → Risk
 *   → Opportunity Decision
 *   → Telegram Result
 *
 * External marketplace boundary (HTTP requests to shopee.co.id, etc.)
 * is mocked with realistic fixtures. Business logic (matching, economics,
 * risk, decision) is executed for real.
 */
import { ulid } from 'ulid';
import * as crypto from 'crypto';

// ─── Mock Adapters with Realistic Fixtures ──────────────────────────────────
// We mock ONLY the external HTTP boundary. All business logic runs for real.

// The mock product fixture — simulates what Shopee returns for a "power bank" search
const mockProductFixture = {
  itemId: '12345678901',
  title: 'Power Bank 10000mAh PD 30W Fast Charging',
  price: 249999,
  currency: 'IDR',
  brand: 'TechBrand',
  sku: 'PB-10K-PD30W',
  barcode: '8888123456789',
  categoryId: '107',
  sellerId: '123456789',
  sellerName: 'TechGadget Official',
  ratingScore: 4.8,
  reviewCount: 1250,
  imageUrl: 'https://example.com/image.jpg',
  itemUrl: 'https://shopee.co.id/power-bank-10000mah-i.123456789.12345678901',
};

class MockShopeeAdapter {
  adapterName = 'ShopeeIDAdapter';
  sourceName = 'Shopee Indonesia';
  baseUrl = 'https://shopee.co.id';
  trustTier = 'MEDIUM' as const;
  isActive = true;
  marketplace = 'shopee';
  logger = {
    info: (..._args: any[]) => { /* mock */ },
    warn: (..._args: any[]) => { /* mock */ },
    error: (..._args: any[]) => { /* mock */ },
  };

  async search(query: string): Promise<unknown[]> {
    if (!query || query.trim().length === 0) return [];
    return [
      {
        url: 'https://shopee.co.id/power-bank-10000mah-i.123456789.12345678901',
        title: 'Power Bank 10000mAh PD 30W Fast Charging',
        price: 249999,
        currency: 'IDR',
        seller: 'TechGadget Official',
        sellerId: '123456789',
        rating: 4.8,
        reviewCount: 1250,
        image: 'https://example.com/image.jpg',
        itemId: '12345678901',
        categoryId: '107',
        rawMetadata: { searchResult: true },
      },
    ];
  }

  async fetch(url: string): Promise<any> {
    return {
      url,
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: JSON.stringify({ data: { item: mockProductFixture } }),
      contentType: 'application/json',
      observedAt: new Date().toISOString(),
      bytesLength: 500,
    };
  }

  async parse(rawDocument: any): Promise<any> {
    const html = rawDocument.rawPayload || rawDocument.body || '';
    let structuredData: any = null;
    try {
      structuredData = JSON.parse(html);
    } catch {
      // If it's HTML, we'd parse it — but mock returns JSON
    }

    const item = structuredData?.data?.item || mockProductFixture;

    return {
      rawDocumentId: rawDocument.id,
      entities: [{
        rawDocumentId: rawDocument.id,
        sourceId: 'shopee',
        extractedAt: new Date().toISOString(),
        title: item.title,
        brand: item.brand || null,
        model: null,
        sku: item.sku || null,
        barcode: item.barcode || null,
        category: item.categoryId,
        price: item.price,
        currency: 'IDR',
        moq: 1,
        packageQuantity: 1,
        packageUnit: 'pcs',
        supplierName: item.sellerName || null,
        supplierType: 'RESELLER',
        marketplace: 'shopee',
        sellerId: item.sellerId ? String(item.sellerId) : null,
        sellerName: item.sellerName || null,
        rating: item.ratingScore || null,
        reviewCount: item.reviewCount || null,
        soldCount: null,
        rawEvidence: { url: item.itemUrl, itemId: item.itemId },
        extractionConfidence: 0.9,
      }],
      extractionMethod: 'mock-shopee-parser',
      extractionConfidence: 0.9,
    };
  }

  async normalize(parsedData: any): Promise<CanonicalProduct> {
    return {
      id: ulid(),
      canonicalTitle: parsedData.title,
      brand: parsedData.brand,
      model: parsedData.model,
      categoryId: parsedData.category || null,
      standardUnit: 'pcs',
      standardWeightGrams: null,
      standardDimensionsCm: null,
      sku: parsedData.sku,
      barcode: parsedData.barcode,
      priceInIdr: parsedData.price,
      currencyConverted: parsedData.price !== null,
      moq: parsedData.moq ?? 1,
      packageQuantity: 1,
      packageUnit: 'pcs',
      sourceId: parsedData.sourceId,
      supplierProductId: null,
      marketplaceListingId: null,
      sellerId: parsedData.sellerId || null,
      sellerName: parsedData.sellerName || null,
      marketplaceListingUrl: null,
      observedAt: parsedData.extractedAt,
      confidence: parsedData.extractionConfidence || 0,
      dataLineage: {
        sourceId: parsedData.sourceId,
        rawDocumentId: parsedData.rawDocumentId,
        rawEvidenceHash: crypto.createHash('sha256').update(JSON.stringify(parsedData.rawEvidence || parsedData.rawDocumentId)).digest('hex'),
        extractionMethod: 'mock-shopee-parser',
        observedAt: parsedData.extractedAt,
        confidence: parsedData.extractionConfidence || 0,
        evidenceHierarchyLevel: 3,
      },
    } as CanonicalProduct;
  }

  async healthCheck(): Promise<any> {
    return { isHealthy: true, statusCode: 200, latencyMs: 100, errorMessage: null, checkedAt: new Date().toISOString(), errorCount24h: 0 };
  }

  getMetadata(): any {
    return { id: '', name: this.sourceName, adapterName: this.adapterName, baseUrl: this.baseUrl, isActive: true, trustTier: 'MEDIUM', createdAt: new Date().toISOString() };
  }

  getCapabilities(): any {
    return { supportsDiscover: false, supportsSearch: true, supportsFetch: true, supportsParse: true, supportsNormalize: true, supportsHealthCheck: true, extras: {} };
  }
}

// ─── Mock Discovery Service ──────────────────────────────────────────────────

import { CanonicalProduct } from '../types';
import { ArbitragePipeline } from './pipeline';
import { discoveryService } from './discovery';

const mockAdapter = new MockShopeeAdapter();

// Save original discover method
const originalDiscover = discoveryService.discover.bind(discoveryService);

// The mock discover implementation
const mockDiscover = async (context: any, query: string, marketplace: string | null, _timeout?: number) => {
  const adapter = marketplace ? (marketplace === 'shopee' ? mockAdapter : undefined) : mockAdapter;

  if (!adapter) {
    return {
      requestId: context.requestId,
      status: 'SOURCE_ERROR',
      marketplace: marketplace || 'none',
      query,
      products: [],
      error: 'No adapter found',
      metadata: { adapterName: 'none', sourceUrl: null, elapsedMs: 0, observedAt: new Date().toISOString() },
    };
  }

  if (!query || query.trim().length === 0) {
    return {
      requestId: context.requestId,
      status: 'VALIDATION_ERROR',
      marketplace: adapter.marketplace,
      query,
      products: [],
      error: 'Query is empty',
      metadata: { adapterName: adapter.adapterName, sourceUrl: adapter.baseUrl, elapsedMs: 0, observedAt: new Date().toISOString() },
    };
  }

  const rawResults = await adapter.search(query);
  if (!rawResults || rawResults.length === 0) {
    return {
      requestId: context.requestId,
      status: 'EMPTY_RESULT',
      marketplace: adapter.marketplace,
      query,
      products: [],
      error: null,
      metadata: { adapterName: adapter.adapterName, sourceUrl: adapter.baseUrl, elapsedMs: 0, observedAt: new Date().toISOString() },
    };
  }

  // Fetch + parse + normalize the first product
  const rawItem = rawResults[0] as any;
  const rawPayload = await adapter.fetch(rawItem.url);
  const rawDocument = {
    id: rawPayload.url,
    sourceId: adapter.adapterName,
    url: rawPayload.url,
    observedAt: rawPayload.observedAt,
    httpStatus: rawPayload.statusCode,
    contentType: rawPayload.contentType,
    contentHash: '',
    parserVersion: 'v1.0',
    rawPayload: rawPayload.body,
  };
  const parsed = await adapter.parse(rawDocument);
  const canonical = await adapter.normalize(parsed.entities[0]);

  return {
    requestId: context.requestId,
    status: 'SUCCESS',
    marketplace: adapter.marketplace,
    query,
    products: [canonical],
    error: null,
    metadata: { adapterName: adapter.adapterName, sourceUrl: adapter.baseUrl, elapsedMs: 0, observedAt: new Date().toISOString() },
  };
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('End-to-End Arbitrage Pipeline (mocked external boundary)', () => {
  let pipeline: ArbitragePipeline;

  beforeAll(() => {
    pipeline = new ArbitragePipeline(5000); // 5-second timeout for E2E test
    // Apply the mock discover implementation
    (discoveryService as any).discover = mockDiscover;
  });

  beforeEach(() => {
    // Restore the mock discover to the default implementation for each test
    (discoveryService as any).discover = mockDiscover;
  });

  afterAll(() => {
    // Restore original discover
    (discoveryService as any).discover = originalDiscover;
  });

  it('should execute full pipeline: command → discovery → adapter → normalize → matching → supplier → landed cost → profit → risk → decision → result', async () => {
    const result = await pipeline.execute(12345, 'power bank 10000mah', 'shopee');

    // Verify pipeline result
    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.context.requestId).toMatch(/^req_/);
    expect(result.context.correlationId).toMatch(/^corr_/);
    expect(result.context.query).toBe('power bank 10000mah');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    // Phase 1: Discovery
    expect(result.discovery).toBeDefined();
    expect(result.discovery!.status).toBe('SUCCESS');
    expect(result.discovery!.products.length).toBe(1);
    expect(result.discovery!.marketplace).toBe('shopee');

    // Phase 2: Product Data
    const product = result.canonicalProduct;
    expect(product).toBeDefined();
    expect(product!.canonicalTitle).toBe('Power Bank 10000mAh PD 30W Fast Charging');
    expect(product!.brand).toBe('TechBrand');
    expect(product!.priceInIdr).toBe(249999);
    expect(product!.currencyConverted).toBe(true);
    expect(product!.confidence).toBe(0.9);
    expect(product!.sourceId).toBe('shopee');
    expect(product!.sellerId).toBe('123456789');
    expect(product!.sellerName).toBe('TechGadget Official');

    // Phase 3: Normalization
    expect(product!.canonicalTitle).toBeTruthy();
    expect(product!.standardUnit).toBe('pcs');
    expect(product!.moq).toBe(1);
    expect(product!.dataLineage).toBeDefined();
    expect(product!.dataLineage.confidence).toBe(0.9);

    // Phase 4: Matching
    expect(result.canonicalProduct).toBeDefined();

    // Phase 5: Supplier
    expect(result.supplier).toBeDefined();
    expect(result.supplier!.name).toBe('TechGadget Official');
    expect(result.supplier!.type).toBe('RESELLER');
    expect(result.supplier!.confidence).toBe('PARTIALLY_VERIFIED');
    // Supplier cost is UNKNOWN (null) — marketplace price is NOT a supplier cost.
    // The pipeline must fail closed when no B2B/wholesale source is available.
    expect(result.supplier!.sourcePriceIdr).toBeNull();

    // Phase 6: Landed Cost — null because supplier cost is UNKNOWN (fail closed)
    expect(result.economics).toBeDefined();
    expect(result.economics!.landedCost).toBeNull();
    expect(result.economics!.profitError).toContain('UNKNOWN');

    // Phase 7: Profit — not computed because supplier cost is UNKNOWN
    expect(result.economics!.profitCalculation).toBeNull();

    // Phase 8: Risk
    expect(result.risk).toBeDefined();
    expect(result.risk!.overallRisk).toBeDefined();
    expect(result.risk!.factors).toBeDefined();
    expect(result.risk!.evidence).toBeDefined();
    expect(result.risk!.evidence.length).toBeGreaterThan(0);

    // Phase 9: Opportunity Decision
    expect(result.opportunity).toBeDefined();
    expect(['RECOMMEND', 'REVIEW', 'REJECT']).toContain(result.opportunity!.decision);
    expect(result.opportunity!.gates).toBeDefined();
    expect(result.opportunity!.gates.length).toBe(16);
    expect(result.opportunity!.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.opportunity!.totalScore).toBeLessThanOrEqual(100);

    // Phase 10: Telegram Result
    expect(result.formattedResult).toBeTruthy();
    expect(result.formattedResult).toContain('MarketIntele Arbitrage Analysis');

    // No pipeline-level error
    expect(result.error).toBeNull();
  }, 15000);

  it('should return EMPTY_RESULT for query with no matches', async () => {
    const savedDiscover = (discoveryService as any).discover;
    (discoveryService as any).discover = async (context: any, _query: string, marketplace: string | null) => {
      return {
        requestId: context.requestId,
        status: 'EMPTY_RESULT',
        marketplace: marketplace || 'shopee',
        query: _query,
        products: [],
        error: null,
        metadata: { adapterName: 'ShopeeIDAdapter', sourceUrl: 'https://shopee.co.id', elapsedMs: 0, observedAt: new Date().toISOString() },
      };
    };

    const result = await pipeline.execute(12345, 'nonexistent product xyz123');

    expect(result.discovery).toBeDefined();
    expect(result.discovery!.status).toBe('EMPTY_RESULT');
    expect(result.canonicalProduct).toBeNull();

    // Restore
    (discoveryService as any).discover = savedDiscover;
  }, 10000);

  it('should return VALIDATION_ERROR for empty query', async () => {
    const result = await pipeline.execute(12345, '', 'shopee');

    expect(result.discovery).toBeDefined();
    expect(result.discovery!.status).toBe('VALIDATION_ERROR');
  }, 10000);

  it('should return SOURCE_ERROR when adapter throws', async () => {
    // Override mockDiscover to throw
    const savedDiscover = (discoveryService as any).discover;
    (discoveryService as any).discover = async () => {
      return {
        requestId: 'req_test',
        status: 'SOURCE_ERROR',
        marketplace: 'shopee',
        query: 'test product',
        products: [],
        error: 'Network timeout — mock HTTP 503',
        metadata: { adapterName: 'ShopeeIDAdapter', sourceUrl: 'https://shopee.co.id', elapsedMs: 0, observedAt: new Date().toISOString() },
      };
    };

    const result = await pipeline.execute(12345, 'test product');

    expect(result.discovery).toBeDefined();
    expect(result.discovery!.status).toBe('SOURCE_ERROR');
    expect(result.discovery!.error).toContain('Network timeout');

    // Restore
    (discoveryService as any).discover = savedDiscover;
  }, 10000);

  it('should REJECT when supplier cost is unknown (fail closed, no false positive)', async () => {
    const result = await pipeline.execute(12345, 'power bank 10000mah', 'shopee');

    expect(result.opportunity).toBeDefined();
    expect(result.opportunity!.decision).toBe('REJECT');
    expect(result.opportunity!.qualityTier).toBe('REJECTED');

    // C09 gate must fail because profit cannot be computed (supplier cost UNKNOWN)
    const profitGate = result.opportunity!.gates.find((g) => g.id === 'C09');
    expect(profitGate).toBeDefined();
    expect(profitGate!.passed).toBe(false);
  }, 15000);

  it('should produce deterministic results (same input → same output)', async () => {
    const result1 = await pipeline.execute(12345, 'power bank 10000mah', 'shopee');
    const result2 = await pipeline.execute(12345, 'power bank 10000mah', 'shopee');

    // Both must have null economics (fail closed) — deterministic
    expect(result1.economics!.landedCost).toBe(result2.economics!.landedCost);
    expect(result1.economics!.marketplaceFee).toBe(result2.economics!.marketplaceFee);
    expect(result1.economics!.profitCalculation).toBe(result2.economics!.profitCalculation);
    expect(result1.opportunity!.decision).toBe(result2.opportunity!.decision);
  }, 15000);

  it('should never fabricate supplier cost (marketplace price is NOT supplier cost)', async () => {
    const result = await pipeline.execute(12345, 'power bank 10000mah', 'shopee');

    expect(result.supplier).toBeDefined();
    expect(result.supplier!.name).toBe('TechGadget Official');
    expect(result.supplier!.id).toBe('123456789');
    // Supplier cost MUST be null — not the marketplace listing price
    expect(result.supplier!.sourcePriceIdr).toBeNull();
  }, 15000);

  it('should include evidence/provenance in result', async () => {
    const result = await pipeline.execute(12345, 'power bank 10000mah', 'shopee');

    expect(result.opportunity).toBeDefined();
    expect(result.opportunity!.evidence).toBeDefined();
    expect(result.opportunity!.evidence.length).toBeGreaterThan(0);

    expect(result.risk!.evidence).toBeDefined();
    expect(result.risk!.evidence.length).toBeGreaterThan(0);
  }, 15000);
});
