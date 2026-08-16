/**
 * Supplier Resolver
 *
 * After product matching, resolves the supplier/source for the matched product.
 *
 * Since we don't have access to real supplier directories (BDI, Kompass, etc.)
 * in production, this module:
 * 1. Checks if the marketplace product itself has supplier info (seller name, seller ID)
 * 2. Derives inferred supplier data from the available evidence
 * 3. Returns SupplierSource with explicit NULL for unknown fields (UNKNOWN != 0)
 *
 * No hardcoded/demo supplier data is ever produced.
 */
import { CanonicalProduct } from '../types';
import { SupplierSource } from './types';

export interface SupplierLookupInput {
  canonicalProduct: CanonicalProduct;
  marketplace: string;
  sellerId: string | null;
  sellerName: string | null;
  productUrl: string | null;
}

export interface SupplierLookupResult {
  supplier: SupplierSource | null;
  reason: string;
}

/**
 * Resolve supplier from marketplace product data.
 *
 * For cross-border arbitrage, the "supplier" is typically the manufacturer/importer
 * in China, India, or other producing country. Without a supplier directory API,
 * we can only derive supplier identity from the marketplace seller itself
 * (which acts as a reseller/distributor).
 *
 * Unknown costs are returned as null — NOT as 0.
 */
export async function resolveSupplier(
  input: SupplierLookupInput,
): Promise<SupplierLookupResult> {
  const { canonicalProduct, sellerId, sellerName, productUrl } = input;

  // If we have a seller ID/name from the marketplace, use that as the supplier
  // The marketplace seller IS the supplier for this product instance
  if (!sellerId && !sellerName) {
    return {
      supplier: null,
      reason:
        'No seller/supplier identity available from marketplace product — cannot resolve supplier',
    };
  }

  const supplier: SupplierSource = {
    id: sellerId || `seller_${sellerName?.replace(/\s+/g, '_') || 'unknown'}`,
    name: sellerName || 'Unknown Seller',
    type: 'RESELLER',  // Marketplace sellers are resellers
    sourceUrl: productUrl || null,
    // IDEA §3.4 / §4 (UNKNOWN != ZERO): The marketplace listing price is a
    // RETAIL price, NOT a supplier (B2B/wholesale) cost.  Using it as the
    // supplier cost would make every opportunity a guaranteed loss (buying
    // and selling at the same price minus fees).  Until a real supplier
    // sourcing engine exists, the supplier cost MUST remain UNKNOWN (null)
    // so that the profit engine fails closed instead of fabricating economics.
    sourcePriceIdr: null,
    moq: canonicalProduct.moq,
    shippingCostIdr: null,  // Unknown — not exposed by marketplace listing
    contactInfo: null,      // Not available from public listing
    evidence: sellerName
      ? `Supplier identity derived from marketplace seller: ${sellerName} (NOTE: supplier cost UNKNOWN — no B2B/wholesale source available)`
      : `Supplier identity derived from marketplace sellerId: ${sellerId} (NOTE: supplier cost UNKNOWN — no B2B/wholesale source available)`,
    confidence: sellerName ? 'PARTIALLY_VERIFIED' : 'UNKNOWN',
    confidenceScore: sellerName ? 0.5 : 0.2,
    observedAt: new Date().toISOString(),
  };

  return {
    supplier,
    reason: sellerName
      ? `Supplier resolved from marketplace seller identity: ${sellerName}`
      : `Supplier resolved from marketplace seller ID: ${sellerId}`,
  };
}

/**
 * Get supplier price tier for a given MOQ.
 *
 * Marketplace prices are single-tier (retail). For B2B pricing,
 * supplier would need to be contacted directly.
 */
export function getSupplierPriceTier(
  supplier: SupplierSource,
  _requestedQty: number,
): { priceIdr: number | null; tier: string } {
  if (supplier.sourcePriceIdr === null) {
    return { priceIdr: null, tier: 'UNKNOWN' };
  }

  // Marketplace sellers typically don't offer bulk discounts
  // The listed price is the best available price
  return {
    priceIdr: supplier.sourcePriceIdr,
    tier: 'RETAIL',
  };
}

/**
 * Derive a reasonable shipping estimate for Indonesian domestic shipping.
 *
 * For marketplace-to-consumer, shipping is included in the listing price or shown separately.
 * For supplier-to-marketplace (cross-border), shipping costs are unknown without
 * actually contacting the supplier.
 *
 * This returns null for unknown shipping — NOT zero.
 */
export function estimateShipping(
  _fromRegion: string | null,
  _toRegion: string | null,
  _weightGrams: number | null,
  _shippingType: 'regular' | 'express',
): number | null {
  // Without actual shipping carrier API integration, shipping cost is UNKNOWN
  // Do NOT hardcode Indonesian shipping rates (they vary by courier, weight, distance)
  return null;
}
