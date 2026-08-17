/**
 * Data Provenance Model — Phase 19
 *
 * Extends the provenance taxonomy to distinguish between:
 *   REAL_OFFICIAL_API    — authenticated official API data
 *   REAL_PUBLIC_WEB      — current data from publicly accessible marketplace pages
 *   REAL_PUBLIC_ENDPOINT — current data from a public endpoint without credentials
 *   TEST_FIXTURE         — deterministic test data
 *   MOCK                 — synthetic test substitute
 *   SIMULATION           — generated or modeled data
 *
 * Only REAL_OFFICIAL_API, REAL_PUBLIC_WEB, and REAL_PUBLIC_ENDPOINT may
 * participate in production analysis. TEST_FIXTURE, MOCK, and SIMULATION
 * MUST NEVER create production opportunities (Phase 19.3).
 *
 * This module also defines the freshness controls (Phase 19.8) and the
 * marketplace source reliability classification (Phase 19.9).
 */

/** The six provenance categories. */
export type DataProvenanceCategory =
  | 'REAL_OFFICIAL_API'
  | 'REAL_PUBLIC_WEB'
  | 'REAL_PUBLIC_ENDPOINT'
  | 'TEST_FIXTURE'
  | 'MOCK'
  | 'SIMULATION';

/** How the data was acquired. */
export type AcquisitionMethod =
  | 'API'
  | 'PUBLIC_WEB'
  | 'PUBLIC_ENDPOINT'
  | 'BROWSER_RENDERED';

/** Reliability tier per Phase 19.9. */
export type SourceReliabilityTier = 'A' | 'B' | 'C' | 'D';

/** Freshness status per Phase 19.8. */
export type FreshnessStatus = 'FRESH' | 'STALE';

/** Max acceptable age for a marketplace observation, in hours. */
export const MAX_MARKETPLACE_OBSERVATION_AGE_HOURS = 24;

/**
 * The full data provenance record attached to every marketplace observation.
 *
 * Per Phase 19.3, every marketplace observation record MUST include:
 *   - category (REAL_*)
 *   - source (marketplace name)
 *   - acquisitionMethod
 *   - retrievedAt (ISO timestamp)
 *   - sourceReference (URL/domain, safe to record)
 */
export interface DataProvenanceRecord {
  category: DataProvenanceCategory;
  source: string;
  acquisitionMethod: AcquisitionMethod;
  retrievedAt: string;
  sourceReference: string;
  /** Reliability tier (A-D) per Phase 19.9. */
  reliabilityTier?: SourceReliabilityTier;
}

/**
 * A marketplace price observation with full provenance and freshness metadata.
 *
 * Per Phase 19.8, every marketplace observation record MUST include:
 *   - retrievedAt
 *   - source
 *   - acquisitionMethod
 *   - observedPrice
 *   - productId
 *   - sellerId (where available)
 *   - freshnessStatus
 */
export interface MarketplaceObservation {
  productId: string | null;
  title: string | null;
  sellerId: string | null;
  sellerName: string | null;
  observedPrice: number | null;
  currency: string;
  retrievedAt: string;
  source: string;
  acquisitionMethod: AcquisitionMethod;
  sourceReference: string;
  freshnessStatus: FreshnessStatus;
  provenance: DataProvenanceRecord;
}

/**
 * Determine whether a provenance category may participate in production
 * analysis. Only REAL_* categories are production-eligible.
 *
 * TEST_FIXTURE, MOCK, and SIMULATION are prohibited from creating
 * production opportunities.
 */
export function isProductionEligibleProvenance(
  category: DataProvenanceCategory,
): boolean {
  return (
    category === 'REAL_OFFICIAL_API' ||
    category === 'REAL_PUBLIC_WEB' ||
    category === 'REAL_PUBLIC_ENDPOINT'
  );
}

/**
 * Compute the freshness status of an observation given its retrieval
 * timestamp and the maximum acceptable age.
 *
 * Per Phase 19.8, if the observation is older than the maximum acceptable
 * age, it is STALE and must NOT generate a production opportunity.
 *
 * @param retrievedAt ISO-8601 timestamp of when the data was retrieved
 * @param maxAgeHours maximum acceptable age in hours (default: 24h)
 * @param nowMs       current time in milliseconds (default: Date.now())
 */
export function computeFreshnessStatus(
  retrievedAt: string,
  maxAgeHours: number = MAX_MARKETPLACE_OBSERVATION_AGE_HOURS,
  nowMs: number = Date.now(),
): FreshnessStatus {
  const retrievedMs = Date.parse(retrievedAt);
  if (Number.isNaN(retrievedMs)) {
    return 'STALE';
  }
  const ageHours = (nowMs - retrievedMs) / (1000 * 60 * 60);
  return ageHours <= maxAgeHours ? 'FRESH' : 'STALE';
}

/**
 * Source priority order per Phase 19.10.
 *
 * 1. REAL_OFFICIAL_API  (highest)
 * 2. REAL_PUBLIC_ENDPOINT
 * 3. REAL_PUBLIC_WEB
 * 4. (NO DATA — fail closed)
 *
 * Never: REAL → MOCK
 * Never: REAL → fabricated fallback
 * Never: missing price → 0
 */
export const SOURCE_PRIORITY: readonly DataProvenanceCategory[] = [
  'REAL_OFFICIAL_API',
  'REAL_PUBLIC_ENDPOINT',
  'REAL_PUBLIC_WEB',
] as const;

/**
 * Compare two provenance categories by source priority.
 * Returns a negative number if `a` has higher priority than `b`.
 */
export function compareProvenancePriority(
  a: DataProvenanceCategory,
  b: DataProvenanceCategory,
): number {
  const ia = SOURCE_PRIORITY.indexOf(a);
  const ib = SOURCE_PRIORITY.indexOf(b);
  // Categories not in the priority list (TEST_FIXTURE/MOCK/SIMULATION) rank below all REAL_*.
  const ra = ia === -1 ? SOURCE_PRIORITY.length : ia;
  const rb = ib === -1 ? SOURCE_PRIORITY.length : ib;
  return ra - rb;
}

/**
 * Reliability classification thresholds per Phase 19.9.
 *
 *   A — production-usable public source (≥95% combined success)
 *   B — usable with elevated monitoring (≥85%)
 *   C — fragile (≥70%)
 *   D — unusable (<70%)
 */
export function classifyReliability(
  combinedSuccessRate: number,
): SourceReliabilityTier {
  if (combinedSuccessRate >= 0.95) return 'A';
  if (combinedSuccessRate >= 0.85) return 'B';
  if (combinedSuccessRate >= 0.70) return 'C';
  return 'D';
}

/**
 * Marketplace reliability metrics tracked per Phase 19.9.
 */
export interface MarketplaceReliabilityMetrics {
  marketplace: string;
  httpSuccessRate: number;
  parseSuccessRate: number;
  priceAvailabilityRate: number;
  productIdentityAvailabilityRate: number;
  avgLatencyMs: number;
  timeoutRate: number;
  rateLimitResponseRate: number;
  antiBotResponseRate: number;
  staleDataRate: number;
  /** Combined success rate = min(httpSuccessRate, parseSuccessRate, priceAvailabilityRate). */
  combinedSuccessRate: number;
  reliabilityTier: SourceReliabilityTier;
}
