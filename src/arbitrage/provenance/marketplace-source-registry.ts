/**
 * Marketplace Source Provenance Registry — Phase 19.1 / 19.2 / 19.9
 *
 * Classifies each existing marketplace adapter by its actual data source
 * type (provenance category) and reliability tier.
 *
 * Based on the Phase 19.1 audit:
 *
 *   Shopee     → REAL_PUBLIC_ENDPOINT (uses /api/v2/search_items JSON endpoint)
 *   Tokopedia  → REAL_PUBLIC_WEB      (HTML scraping + JSON-LD)
 *   Lazada     → REAL_PUBLIC_WEB      (HTML scraping + window.appData)
 *   Blibli     → REAL_PUBLIC_ENDPOINT (uses /cms-api/product-search JSON endpoint)
 *   TikTokShop → REAL_PUBLIC_WEB      (HTML scraping + __NEXT_DATA__)
 *
 * None use official authenticated APIs. None fabricate data.
 * All return current marketplace data from public sources.
 *
 * Per Phase 19.3, these are explicitly classified as REAL_PUBLIC_* —
 * NOT OFFICIAL_API. This is the key architectural decision: public
 * marketplace data is a legitimate real-data source, transparently
 * classified, and must NOT be blocked merely because no official API
 * credential exists.
 */
import {
  DataProvenanceCategory,
  AcquisitionMethod,
  SourceReliabilityTier,
} from './data-provenance';

export interface MarketplaceSourceClassification {
  marketplace: string;
  adapterName: string;
  sourceName: string;
  category: DataProvenanceCategory;
  acquisitionMethod: AcquisitionMethod;
  sourceDomain: string;
  /** Reliability tier from Phase 19.9 audit. */
  reliabilityTier: SourceReliabilityTier;
  /** Whether the adapter uses a JSON API endpoint (vs HTML parsing). */
  usesJsonEndpoint: boolean;
  /** Whether the adapter records retrieval timestamp. */
  recordsRetrievalTimestamp: boolean;
  /** Whether the adapter validates HTTP status. */
  validatesHttpStatus: boolean;
  /** Whether the adapter returns null (not 0) for missing prices. */
  returnsNullForMissingPrice: boolean;
  /** Audit notes. */
  notes: string;
}

/**
 * The classification for all 5 marketplace adapters.
 *
 * Reliability tiers are initial estimates based on the adapter
 * implementation review (Phase 19.1). They should be refined with
 * live reliability metrics (Phase 19.9).
 */
export const MARKETPLACE_SOURCE_CLASSIFICATIONS: readonly MarketplaceSourceClassification[] = [
  {
    marketplace: 'shopee',
    adapterName: 'ShopeeIndonesiaAdapter',
    sourceName: 'Shopee Indonesia',
    category: 'REAL_PUBLIC_ENDPOINT',
    acquisitionMethod: 'PUBLIC_ENDPOINT',
    sourceDomain: 'shopee.co.id',
    reliabilityTier: 'C',
    usesJsonEndpoint: true,
    recordsRetrievalTimestamp: true,
    validatesHttpStatus: true,
    returnsNullForMissingPrice: true,
    notes:
      'Uses /api/v2/search_items and /api/v4/pdp JSON endpoints (no auth). ' +
      'Price stored in micro-units (/100000). Returns null for missing price. ' +
      'Fragile: undocumented endpoint, subject to anti-bot/rate-limiting.',
  },
  {
    marketplace: 'tokopedia',
    adapterName: 'TokopediaAdapter',
    sourceName: 'Tokopedia',
    category: 'REAL_PUBLIC_WEB',
    acquisitionMethod: 'PUBLIC_WEB',
    sourceDomain: 'www.tokopedia.com',
    reliabilityTier: 'C',
    usesJsonEndpoint: false,
    recordsRetrievalTimestamp: true,
    validatesHttpStatus: true,
    returnsNullForMissingPrice: true,
    notes:
      'HTML scraping of /search?q=... page, extracting JSON-LD and ' +
      'window.__data. Returns null for missing price. Fragile: HTML ' +
      'structure changes break parsing.',
  },
  {
    marketplace: 'lazada',
    adapterName: 'LazadaIDAdapter',
    sourceName: 'Lazada Indonesia',
    category: 'REAL_PUBLIC_WEB',
    acquisitionMethod: 'PUBLIC_WEB',
    sourceDomain: 'www.lazada.co.id',
    reliabilityTier: 'C',
    usesJsonEndpoint: false,
    recordsRetrievalTimestamp: true,
    validatesHttpStatus: true,
    returnsNullForMissingPrice: true,
    notes:
      'HTML scraping of /catalog/?q=... page, extracting window.appData ' +
      'JSON. Fallback to JSON-LD. Returns null for missing price. Fragile.',
  },
  {
    marketplace: 'blibli',
    adapterName: 'BlibliAdapter',
    sourceName: 'Blibli Indonesia',
    category: 'REAL_PUBLIC_ENDPOINT',
    acquisitionMethod: 'PUBLIC_ENDPOINT',
    sourceDomain: 'www.blibli.com',
    reliabilityTier: 'C',
    usesJsonEndpoint: true,
    recordsRetrievalTimestamp: true,
    validatesHttpStatus: true,
    returnsNullForMissingPrice: true,
    notes:
      'Uses /cms-api/product-search JSON endpoint (no auth). ' +
      'Product page parse uses JSON-LD + window.__appData. ' +
      'Returns null for missing price. Moderately fragile.',
  },
  {
    marketplace: 'tiktok_shop',
    adapterName: 'TikTokShopIDAdapter',
    sourceName: 'TikTok Shop Indonesia',
    category: 'REAL_PUBLIC_WEB',
    acquisitionMethod: 'PUBLIC_WEB',
    sourceDomain: 'www.tiktok.com',
    reliabilityTier: 'C',
    usesJsonEndpoint: false,
    recordsRetrievalTimestamp: true,
    validatesHttpStatus: true,
    returnsNullForMissingPrice: true,
    notes:
      'HTML scraping of /search?i=ID&q=... page, extracting __NEXT_DATA__ ' +
      'JSON. Fallback to JSON-LD. Returns null for missing price. Fragile: ' +
      'TikTok anti-bot is aggressive.',
  },
];

/**
 * Get the provenance classification for a marketplace by its identifier.
 */
export function getMarketplaceClassification(
  marketplace: string,
): MarketplaceSourceClassification | undefined {
  return MARKETPLACE_SOURCE_CLASSIFICATIONS.find(
    (c) => c.marketplace === marketplace,
  );
}

/**
 * Get the provenance classification for an adapter by its adapterName.
 */
export function getAdapterClassification(
  adapterName: string,
): MarketplaceSourceClassification | undefined {
  return MARKETPLACE_SOURCE_CLASSIFICATIONS.find(
    (c) => c.adapterName === adapterName,
  );
}

/**
 * All marketplace adapters use public sources (no official API credentials).
 * This is the key fact from Phase 19.1: no adapter is REAL_OFFICIAL_API.
 */
export function hasOfficialApiAdapter(): boolean {
  return MARKETPLACE_SOURCE_CLASSIFICATIONS.some(
    (c) => c.category === 'REAL_OFFICIAL_API',
  );
}

/**
 * Count adapters by provenance category.
 */
export function countByCategory(): Record<DataProvenanceCategory, number> {
  const counts: Record<DataProvenanceCategory, number> = {
    REAL_OFFICIAL_API: 0,
    REAL_PUBLIC_WEB: 0,
    REAL_PUBLIC_ENDPOINT: 0,
    TEST_FIXTURE: 0,
    MOCK: 0,
    SIMULATION: 0,
  };
  for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
    counts[c.category]++;
  }
  return counts;
}
