/**
 * Supplier Sourcing Engine — Abstraction + TEST_FIXTURE adapter
 *
 * IDEA.md §9–§12 require a genuine supplier discovery subsystem with
 * manufacturer/factory/distributor/wholesale sources.  The previous
 * implementation derived "supplier" from the marketplace seller (a
 * RESELLER) and always returned null for supplier cost — making it
 * impossible to ever produce a real arbitrage opportunity.
 *
 * This module defines:
 *   - SupplierSourceEntity: the canonical supplier entity (IDEA §10)
 *   - SupplierAdapter: the adapter interface for supplier directories
 *   - TestFixtureSupplierAdapter: a deterministic, EXPLICITLY-LABELLED
 *     TEST_FIXTURE adapter (IDEA §58) that never pretends to be real data.
 *
 * Real supplier adapters (Alibaba API, B2B directories, etc.) would
 * implement this interface.  The TEST_FIXTURE adapter allows the pipeline
 * to produce a complete vertical slice during development while being
 * unmistakably marked as non-production data.
 */
import { SupplierSource } from '../pipeline/types';
import { CanonicalProduct } from '../types';

/** Canonical supplier entity per IDEA.md §10. */
export interface SupplierSourceEntity {
  supplierId: string;
  supplierName: string;
  supplierType:
    | 'FACTORY'
    | 'MANUFACTURER'
    | 'DISTRIBUTOR'
    | 'IMPORTER'
    | 'WHOLESALER'
    | 'TRADING_COMPANY'
    | 'RESELLER'
    | 'UNKNOWN';
  legalName: string | null;
  website: string | null;
  domain: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  catalogUrl: string | null;
  sourceUrls: string[];
  verificationStatus: 'UNVERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFIED' | 'HIGH_CONFIDENCE' | 'SUSPICIOUS' | 'UNKNOWN';
  supplierScore: number;       // 0-1
  supplierConfidence: number;  // 0-1
  firstSeenAt: string;
  lastVerifiedAt: string | null;
  /** Data provenance — REAL / TEST_FIXTURE / MOCK (IDEA §59). */
  dataProvenance: 'REAL' | 'TEST_FIXTURE' | 'MOCK' | 'SIMULATION';
  evidence: string[];
}

/** Supplier pricing per IDEA.md §12. */
export interface SupplierPricing {
  unitPriceIdr: number | null;   // null = UNKNOWN (not zero)
  currency: string;
  moq: number | null;
  priceTiers: Array<{ minQty: number; maxQty: number | null; unitPriceIdr: number }> | null;
  taxIncluded: boolean;
  shippingIncluded: boolean;
  leadTimeDays: number | null;
  stock: number | null;
  paymentTerms: string | null;
  validUntil: string | null;
  /** Data provenance. */
  dataProvenance: 'REAL' | 'TEST_FIXTURE' | 'MOCK';
  evidence: string[];
}

/** A supplier offer combining identity + pricing. */
export interface SupplierOffer {
  supplier: SupplierSourceEntity;
  pricing: SupplierPricing;
  matchConfidence: number;       // 0-1 — how well the supplier product matches
  evidence: string[];
}

/**
 * Supplier adapter interface — each real supplier source implements this.
 */
export interface SupplierAdapter {
  readonly adapterName: string;
  readonly sourceName: string;
  readonly dataProvenance: 'REAL' | 'TEST_FIXTURE' | 'MOCK';

  /**
   * Search for suppliers offering a product matching the query.
   * Returns offers with full provenance — never fabricated.
   */
  searchSuppliers(query: string, product: CanonicalProduct): Promise<SupplierOffer[]>;

  /** Verify a supplier's identity and business classification. */
  verifySupplier(supplier: SupplierSourceEntity): Promise<SupplierSourceEntity>;

  /** Health check. */
  healthCheck?(): Promise<boolean>;
}

/**
 * Convert a SupplierOffer to the pipeline's SupplierSource type.
 *
 * Preserves the UNKNOWN invariant: null prices stay null.
 */
export function offerToSupplierSource(offer: SupplierOffer): SupplierSource {
  return {
    id: offer.supplier.supplierId,
    name: offer.supplier.supplierName,
    type: offer.supplier.supplierType as SupplierSource['type'],
    sourceUrl: offer.supplier.website || offer.supplier.sourceUrls[0] || null,
    sourcePriceIdr: offer.pricing.unitPriceIdr,
    moq: offer.pricing.moq,
    shippingCostIdr: null, // shipping requires a separate freight quote
    contactInfo: offer.supplier.email || offer.supplier.phone || null,
    evidence: offer.evidence.join('; '),
    confidence: mapVerificationToConfidence(offer.supplier.verificationStatus),
    confidenceScore: offer.supplier.supplierConfidence,
    observedAt: new Date().toISOString(),
  };
}

function mapVerificationToConfidence(
  status: SupplierSourceEntity['verificationStatus'],
): SupplierSource['confidence'] {
  switch (status) {
    case 'HIGH_CONFIDENCE':
    case 'VERIFIED':
      return 'VERIFIED';
    case 'PARTIALLY_VERIFIED':
      return 'PARTIALLY_VERIFIED';
    case 'SUSPICIOUS':
    case 'UNKNOWN':
    case 'UNVERIFIED':
      return 'UNKNOWN';
    default:
      return 'UNKNOWN';
  }
}
