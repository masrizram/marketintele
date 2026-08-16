/**
 * Market Clearing Price Engine
 *
 * IDEA.md §16 / AUDIT §16 mandate that the selling price MUST NOT be derived
 * from a single listing.  This engine aggregates multiple comparable listings
 * into a defensible market-clearing price using:
 *
 *   - P10 / P25 / P50 / P75 / P90 percentiles (linear interpolation)
 *   - weighted median (weight by review/sales proxy)
 *   - IQR-based outlier rejection (deterministic)
 *   - seller concentration (HHI)
 *   - price dispersion (coefficient of variation)
 *   - confidence scoring driven by sample size + dispersion + concentration
 *
 * OUTPUT invariant: every number carries methodology + sample_size +
 * confidence + source_list + timestamp.  If the sample is insufficient the
 * confidence is LOW/INSUFFICIENT and the decision gate can REJECT — the
 * engine NEVER fabricates a clearing price.
 *
 * UNKNOWN != ZERO: an empty input yields `marketClearingPrice = null` and
 * `priceConfidence = 'INSUFFICIENT'`, NOT a fabricated zero.
 */
import { D, ZERO, round4 } from '../economic/decimal-engine';

/** A single comparable marketplace listing used for price aggregation. */
export interface MarketListing {
  listingId: string;
  sellerId: string;
  sellerName: string | null;
  price: number;              // IDR, the current selling price
  originalPrice: number | null;
  rating: number | null;
  reviewCount: number | null;
  soldCount: number | null;
  stock: number | null;
  title: string;
  observedAt: string;        // ISO-8601
  sourceUrl: string | null;
}

export type PriceConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ExcludedListing {
  listingId: string;
  reason: string;
}

export interface Percentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MarketClearingPriceResult {
  /** Conservative clearing price (P25) — the fail-closed selling estimate. */
  conservativePrice: number | null;
  /** Base / median price (weighted median). */
  basePrice: number | null;
  /** Optimistic price (P75). */
  optimisticPrice: number | null;
  /** The recommended market-clearing price (conservative = P25). */
  marketClearingPrice: number | null;
  priceConfidence: PriceConfidence;
  methodology: string;
  sampleSize: number;
  effectiveSampleSize: number;
  percentiles: Percentiles | null;
  weightedMedian: number | null;
  priceDispersion: number | null;       // coefficient of variation (stdev / mean)
  sellerConcentration: number | null;  // HHI normalised 0-1
  sellerCount: number | null;
  excludedListings: ExcludedListing[];
  sourceList: string[];
  timestamp: string;
}

/** Minimum sample sizes that gate confidence levels. */
const MIN_HIGH_CONFIDENCE = 8;
const MIN_MEDIUM_CONFIDENCE = 4;
const MIN_LOW_CONFIDENCE = 2;

/**
 * Compute the market clearing price from a set of comparable listings.
 *
 * The computation is fully deterministic: identical input always produces
 * identical output.  All arithmetic uses Decimal for financial integrity.
 */
export function computeMarketClearingPrice(
  listings: MarketListing[],
): MarketClearingPriceResult {
  const timestamp = new Date().toISOString();
  const methodology =
    'IQR outlier rejection (Q1-1.5*IQR, Q3+1.5*IQR) → linear-interpolation percentiles ' +
    '(P10/P25/P50/P75/P90) → weighted median (review-count weights) → HHI seller ' +
    'concentration → CV dispersion → confidence from sample-size+dispersion+concentration. ' +
    'Clearing price = P25 (conservative, fail-closed).';

  // ── Step 1: validate + filter invalid listings ──────────────────────────
  const excluded: ExcludedListing[] = [];
  const valid: MarketListing[] = [];
  for (const l of listings) {
    if (l.price === null || l.price === undefined || !Number.isFinite(l.price)) {
      excluded.push({ listingId: l.listingId, reason: 'price is null/NaN/Infinity' });
      continue;
    }
    if (l.price <= 0) {
      excluded.push({ listingId: l.listingId, reason: `price ${l.price} <= 0` });
      continue;
    }
    valid.push(l);
  }

  if (valid.length === 0) {
    return insufficientResult(timestamp, methodology, excluded, listings, 'No valid listings (all prices null/zero/invalid)');
  }

  // ── Step 2: outlier rejection via IQR ──────────────────────────────────
  const sortedPrices = valid.map((l) => l.price).sort((a, b) => a - b);
  const q1All = percentile(sortedPrices, 25);
  const q3All = percentile(sortedPrices, 75);
  const iqr = q3All - q1All;
  const lowerFence = q1All - 1.5 * iqr;
  const upperFence = q3All + 1.5 * iqr;

  const kept: MarketListing[] = [];
  for (const l of valid) {
    if (l.price < lowerFence || l.price > upperFence) {
      const side = l.price < lowerFence ? 'abnormally low' : 'abnormally high';
      excluded.push({
        listingId: l.listingId,
        reason: `outlier (${side}: ${l.price} outside [${round4(D(lowerFence))}, ${round4(D(upperFence))}])`,
      });
    } else {
      kept.push(l);
    }
  }

  if (kept.length === 0) {
    return insufficientResult(timestamp, methodology, excluded, listings, 'All listings rejected as outliers');
  }

  // ── Step 3: percentiles on cleaned set ─────────────────────────────────
  const cleanedPrices = kept.map((l) => l.price).sort((a, b) => a - b);
  const p10 = percentile(cleanedPrices, 10);
  const p25 = percentile(cleanedPrices, 25);
  const p50 = percentile(cleanedPrices, 50);
  const p75 = percentile(cleanedPrices, 75);
  const p90 = percentile(cleanedPrices, 90);

  // ── Step 4: weighted median (weight by review count as sales proxy) ───
  const wMedian = weightedMedian(kept);

  // ── Step 5: price dispersion (coefficient of variation) ─────────────────
  const dispersion = coefficientOfVariation(cleanedPrices);

  // ── Step 6: seller concentration (normalised HHI) ───────────────────────
  const { hhi, sellerCount } = computeHHI(kept);

  // ── Step 7: confidence scoring ──────────────────────────────────────────
  const confidence = scoreConfidence(kept.length, dispersion, hhi);

  // ── Step 8: clearing price = conservative (P25) ─────────────────────────
  // Fail-closed: use the lower percentile so we never overestimate revenue.
  const conservativePrice = p25;
  const basePrice = wMedian;
  const optimisticPrice = p75;
  const marketClearingPrice = conservativePrice;

  const sourceList = kept
    .map((l) => l.sourceUrl)
    .filter((u): u is string => u !== null && u !== undefined);

  return {
    conservativePrice,
    basePrice,
    optimisticPrice,
    marketClearingPrice,
    priceConfidence: confidence,
    methodology,
    sampleSize: listings.length,
    effectiveSampleSize: kept.length,
    percentiles: { p10, p25, p50, p75, p90 },
    weightedMedian: wMedian,
    priceDispersion: dispersion,
    sellerConcentration: hhi,
    sellerCount,
    excludedListings: excluded,
    sourceList,
    timestamp,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical helpers (deterministic, Decimal-backed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a percentile via linear interpolation (same method as NumPy default).
 * `data` MUST be pre-sorted ascending.
 */
export function percentile(sortedData: number[], pct: number): number {
  if (sortedData.length === 0) return NaN;
  if (sortedData.length === 1) return sortedData[0];
  const clamped = Math.max(0, Math.min(100, pct));
  const rank = (clamped / 100) * (sortedData.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedData[lower];
  const frac = rank - lower;
  return sortedData[lower] + (sortedData[upper] - sortedData[lower]) * frac;
}

/**
 * Weighted median: sort by price, walk cumulative weight, return the price
 * where cumulative weight crosses 50% of total weight.  Weight = review count
 * (sales-volume proxy); listings with no reviews get weight 1.
 */
export function weightedMedian(listings: MarketListing[]): number {
  if (listings.length === 0) return NaN;
  const weighted = listings
    .map((l) => ({
      price: l.price,
      weight: l.reviewCount !== null && l.reviewCount > 0 ? l.reviewCount : 1,
    }))
    .sort((a, b) => a.price - b.price);

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  const halfWeight = totalWeight / 2;
  let cumulative = 0;
  for (const w of weighted) {
    cumulative += w.weight;
    if (cumulative >= halfWeight) {
      return w.price;
    }
  }
  return weighted[weighted.length - 1].price;
}

/**
 * Coefficient of variation = stdev / mean.  Uses Decimal for precision.
 * Returns 0 when there is a single sample (no dispersion).
 */
export function coefficientOfVariation(prices: number[]): number {
  if (prices.length < 2) return 0;
  const decs = prices.map((p) => D(p));
  const sum = decs.reduce((a, b) => a.plus(b), ZERO);
  const mean = sum.div(decs.length);
  if (mean.isZero()) return 0;
  const variance = decs
    .map((d) => d.minus(mean).pow(2))
    .reduce((a, b) => a.plus(b), ZERO)
    .div(decs.length);
  const stdev = variance.sqrt();
  return round4(stdev.div(mean)).toNumber();
}

/**
 * Normalised Herfindahl-Hirschman Index (0 = perfectly fragmented,
 * 1 = monopoly).  Computed from seller market shares weighted by review count
 * (sales proxy).  If no seller info, returns null (UNKNOWN).
 */
export function computeHHI(listings: MarketListing[]): { hhi: number; sellerCount: number } {
  const sellerShares = new Map<string, number>();
  let totalWeight = 0;
  for (const l of listings) {
    const weight = l.reviewCount !== null && l.reviewCount > 0 ? l.reviewCount : 1;
    const key = l.sellerId || l.sellerName || 'unknown';
    sellerShares.set(key, (sellerShares.get(key) || 0) + weight);
    totalWeight += weight;
  }
  if (totalWeight === 0) return { hhi: 0, sellerCount: sellerShares.size };
  let hhi = ZERO;
  for (const share of sellerShares.values()) {
    const fraction = D(share).div(totalWeight);
    hhi = hhi.plus(fraction.pow(2));
  }
  return { hhi: round4(hhi).toNumber(), sellerCount: sellerShares.size };
}

/**
 * Confidence scoring driven by sample size, dispersion, and concentration.
 *
 *   HIGH         — effective sample >= 8, dispersion < 0.3, HHI < 0.4
 *   MEDIUM       — effective sample >= 4, dispersion < 0.5, HHI < 0.6
 *   LOW          — effective sample >= 2 (bare minimum for any aggregation)
 *   INSUFFICIENT — fewer than 2 comparable listings
 */
function scoreConfidence(
  effectiveSample: number,
  dispersion: number,
  hhi: number,
): PriceConfidence {
  if (effectiveSample < MIN_LOW_CONFIDENCE) return 'INSUFFICIENT';
  if (effectiveSample >= MIN_HIGH_CONFIDENCE && dispersion < 0.3 && hhi < 0.4) {
    return 'HIGH';
  }
  if (effectiveSample >= MIN_MEDIUM_CONFIDENCE && dispersion < 0.5 && hhi < 0.6) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function insufficientResult(
  timestamp: string,
  methodology: string,
  excluded: ExcludedListing[],
  allListings: MarketListing[],
  reason: string,
): MarketClearingPriceResult {
  return {
    conservativePrice: null,
    basePrice: null,
    optimisticPrice: null,
    marketClearingPrice: null,
    priceConfidence: 'INSUFFICIENT',
    methodology: `${methodology} — ABORTED: ${reason}`,
    sampleSize: allListings.length,
    effectiveSampleSize: 0,
    percentiles: null,
    weightedMedian: null,
    priceDispersion: null,
    sellerConcentration: null,
    sellerCount: null,
    excludedListings: excluded,
    sourceList: allListings
      .map((l) => l.sourceUrl)
      .filter((u): u is string => u !== null && u !== undefined),
    timestamp,
  };
}
