/**
 * TEST_FIXTURE Supplier Adapter
 *
 * IDEA.md §58: test fixtures MUST be explicitly marked as TEST_FIXTURE.
 * They MUST NEVER be presented as real supplier data or used in production
 * execution paths.
 *
 * This adapter provides deterministic, realistic-shaped supplier offers so
 * that the arbitrage pipeline can produce a COMPLETE VERTICAL SLICE during
 * development and testing — proving the end-to-end flow works when real
 * supplier data IS available.
 *
 * Every offer from this adapter is stamped:
 *   dataProvenance: 'TEST_FIXTURE'
 *   evidence: ['TEST_FIXTURE — NOT REAL DATA — for development/testing only']
 *
 * In production, this adapter MUST be replaced with a real SupplierAdapter
 * (official API, B2B directory, verified supplier quotations).
 */
import { SupplierAdapter, SupplierOffer, SupplierSourceEntity, SupplierPricing } from './supplier-adapter';
import { CanonicalProduct } from '../types';

export class TestFixtureSupplierAdapter implements SupplierAdapter {
  readonly adapterName = 'TestFixtureSupplierAdapter';
  readonly sourceName = 'TEST_FIXTURE Supplier Directory';
  readonly dataProvenance = 'TEST_FIXTURE' as const;

  /**
   * Return deterministic TEST_FIXTURE supplier offers for a product query.
   *
   * The fixture produces a wholesale price that is meaningfully below the
   * marketplace retail price so the pipeline can demonstrate a positive
   * arbitrage opportunity — but the data is EXPLICITLY fake.
   */
  async searchSuppliers(query: string, product: CanonicalProduct): Promise<SupplierOffer[]> {
    // Only produce fixture offers when a marketplace price exists to
    // establish a realistic arbitrage spread.
    if (product.priceInIdr === null || product.priceInIdr <= 0) {
      return [];
    }

    const retailPrice = product.priceInIdr;
    // Fixture wholesale price: ~40% of retail (typical B2B-to-retail markup)
    const wholesalePrice = Math.round(retailPrice * 0.4);

    const supplier: SupplierSourceEntity = {
      supplierId: 'fixture_supplier_001',
      supplierName: '[TEST_FIXTURE] Shenzhen Electronics Co., Ltd.',
      supplierType: 'MANUFACTURER',
      legalName: null,
      website: 'https://example-fixture.com/manufacturer',
      domain: 'example-fixture.com',
      country: 'China',
      province: 'Guangdong',
      city: 'Shenzhen',
      address: null,
      phone: null,
      email: null,
      catalogUrl: null,
      sourceUrls: ['https://example-fixture.com/catalog/test-fixture'],
      verificationStatus: 'PARTIALLY_VERIFIED',
      supplierScore: 0.6,
      supplierConfidence: 0.5,
      firstSeenAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      dataProvenance: 'TEST_FIXTURE',
      evidence: [
        'TEST_FIXTURE — NOT REAL DATA — for development/testing only',
        `Fixture wholesale price = ${wholesalePrice} IDR (40% of retail ${retailPrice})`,
        'Replace with real SupplierAdapter for production use',
      ],
    };

    const pricing: SupplierPricing = {
      unitPriceIdr: wholesalePrice,
      currency: 'IDR',
      moq: 50,
      priceTiers: [
        { minQty: 1, maxQty: 49, unitPriceIdr: Math.round(wholesalePrice * 1.1) },
        { minQty: 50, maxQty: 99, unitPriceIdr: wholesalePrice },
        { minQty: 100, maxQty: null, unitPriceIdr: Math.round(wholesalePrice * 0.9) },
      ],
      taxIncluded: false,
      shippingIncluded: false,
      leadTimeDays: 14,
      stock: 500,
      paymentTerms: '30% deposit, 70% before shipping',
      validUntil: null,
      dataProvenance: 'TEST_FIXTURE',
      evidence: ['TEST_FIXTURE pricing — NOT A REAL QUOTATION'],
    };

    const offer: SupplierOffer = {
      supplier,
      pricing,
      matchConfidence: 0.7,
      evidence: [
        'TEST_FIXTURE — NOT REAL DATA — for development/testing only',
        `Query: ${query}`,
        `Fixture match based on product title: ${product.canonicalTitle}`,
      ],
    };

    return [offer];
  }

  async verifySupplier(supplier: SupplierSourceEntity): Promise<SupplierSourceEntity> {
    // TEST_FIXTURE verification — does NOT represent real verification.
    return {
      ...supplier,
      verificationStatus: 'PARTIALLY_VERIFIED',
      evidence: [
        ...supplier.evidence,
        'TEST_FIXTURE verification — NOT a real business verification',
      ],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true; // fixture is always "healthy"
  }
}
