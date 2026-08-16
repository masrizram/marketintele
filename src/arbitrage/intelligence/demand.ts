/**
 * Demand Intelligence Engine
 *
 * IDEA.md §18 / AUDIT §24 require a demand engine that classifies every
 * signal as OBSERVED / MODEL_ESTIMATE / HEURISTIC / INSUFFICIENT_DATA and
 * NEVER presents a heuristic as an observed fact.
 *
 * Output: demand_score (0-1), demand_confidence (0-1), demand_trend,
 * demand_velocity, demand_class, with per-signal provenance.
 *
 * UNKNOWN != ZERO: when signals are missing, the demand_score stays null
 * and the class is UNKNOWN — it is never silently inflated to HIGH.
 */
import { D, ZERO, round4 } from '../economic/decimal-engine';

export type SignalProvenance = 'OBSERVED' | 'MODEL_ESTIMATE' | 'HEURISTIC' | 'INSUFFICIENT_DATA';
export type DemandTrend = 'RISING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';
export type DemandClass = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface DemandSignal {
  name: string;
  /** Raw observed value (null when not available). */
  rawValue: number | null;
  /** Normalised 0-1 score contribution (null when insufficient). */
  normalizedScore: number | null;
  weight: number;
  provenance: SignalProvenance;
  evidence: string;
}

export interface DemandInput {
  soldCount: number | null;
  reviewCount: number | null;
  reviewVelocity: number | null;   // reviews per day (or per period)
  ranking: number | null;          // marketplace search rank (lower = better)
  listingGrowth: number | null;    // new listings per period
  sellerCount: number | null;
  historicalPriceObservations: number[];
  observedAt: string;
}

export interface DemandResult {
  demandScore: number | null;        // 0-1, null = UNKNOWN
  demandConfidence: number;          // 0-1
  demandTrend: DemandTrend;
  demandVelocity: number | null;     // rate of change (reviews/day or normalised)
  demandClass: DemandClass;
  signals: DemandSignal[];
  methodology: string;
  timestamp: string;
  evidence: string[];
}

/**
 * Assess demand from available marketplace signals.
 *
 * Only OBSERVED signals (sold_count, review_count) carry high weight.
 * Heuristic signals (ranking, listing growth) are down-weighted and clearly
 * labelled.  Missing signals contribute nothing (INSUFFICIENT_DATA).
 */
export function assessDemand(input: DemandInput): DemandResult {
  const timestamp = new Date().toISOString();
  const methodology =
    'Weighted multi-signal aggregation: sold_count + review_count (OBSERVED, ' +
    'high weight) + review_velocity + ranking + listing_growth (HEURISTIC, ' +
    'low weight).  Score normalised 0-1.  Class thresholds: HIGH>=0.7, ' +
    'MEDIUM>=0.4, LOW>=0.15, else UNKNOWN.  Confidence from signal coverage.';
  const signals: DemandSignal[] = [];
  const evidence: string[] = [];

  // ── Signal 1: sold count (OBSERVED, weight 0.35) ───────────────────────
  if (input.soldCount !== null && input.soldCount >= 0) {
    // Logarithmic normalisation: 1000+ sold = 1.0, 100 = ~0.67, 10 = ~0.33
    const norm = input.soldCount > 0
      ? Math.min(1, Math.log10(input.soldCount + 1) / 3)
      : 0;
    signals.push({
      name: 'sold_count',
      rawValue: input.soldCount,
      normalizedScore: round4(D(norm)).toNumber(),
      weight: 0.35,
      provenance: 'OBSERVED',
      evidence: `sold_count=${input.soldCount} → normalized ${norm.toFixed(3)}`,
    });
    evidence.push(`OBSERVED: sold_count=${input.soldCount}`);
  } else {
    signals.push({
      name: 'sold_count',
      rawValue: input.soldCount,
      normalizedScore: null,
      weight: 0.35,
      provenance: 'INSUFFICIENT_DATA',
      evidence: 'sold_count not available',
    });
  }

  // ── Signal 2: review count (OBSERVED, weight 0.25) ─────────────────────
  if (input.reviewCount !== null && input.reviewCount >= 0) {
    const norm = input.reviewCount > 0
      ? Math.min(1, Math.log10(input.reviewCount + 1) / 3)
      : 0;
    signals.push({
      name: 'review_count',
      rawValue: input.reviewCount,
      normalizedScore: round4(D(norm)).toNumber(),
      weight: 0.25,
      provenance: 'OBSERVED',
      evidence: `review_count=${input.reviewCount} → normalized ${norm.toFixed(3)}`,
    });
    evidence.push(`OBSERVED: review_count=${input.reviewCount}`);
  } else {
    signals.push({
      name: 'review_count',
      rawValue: input.reviewCount,
      normalizedScore: null,
      weight: 0.25,
      provenance: 'INSUFFICIENT_DATA',
      evidence: 'review_count not available',
    });
  }

  // ── Signal 3: review velocity (OBSERVED if measured, weight 0.15) ──────
  if (input.reviewVelocity !== null && input.reviewVelocity >= 0) {
    // 5 reviews/day = 1.0, 1/day = ~0.7, 0.1/day = ~0.3
    const norm = input.reviewVelocity > 0
      ? Math.min(1, Math.log10(input.reviewVelocity * 10 + 1))
      : 0;
    signals.push({
      name: 'review_velocity',
      rawValue: input.reviewVelocity,
      normalizedScore: round4(D(norm)).toNumber(),
      weight: 0.15,
      provenance: 'OBSERVED',
      evidence: `review_velocity=${input.reviewVelocity}/period → normalized ${norm.toFixed(3)}`,
    });
    evidence.push(`OBSERVED: review_velocity=${input.reviewVelocity}`);
  } else {
    signals.push({
      name: 'review_velocity',
      rawValue: input.reviewVelocity,
      normalizedScore: null,
      weight: 0.15,
      provenance: 'INSUFFICIENT_DATA',
      evidence: 'review_velocity not available',
    });
  }

  // ── Signal 4: ranking (HEURISTIC, weight 0.10) ─────────────────────────
  if (input.ranking !== null && input.ranking > 0) {
    // Rank 1 = 1.0, rank 100 = ~0.33, rank 1000 = ~0
    const norm = Math.max(0, 1 - Math.log10(input.ranking) / 3);
    signals.push({
      name: 'ranking',
      rawValue: input.ranking,
      normalizedScore: round4(D(norm)).toNumber(),
      weight: 0.10,
      provenance: 'HEURISTIC',
      evidence: `ranking=${input.ranking} → normalized ${norm.toFixed(3)} (heuristic)`,
    });
    evidence.push(`HEURISTIC: ranking=${input.ranking}`);
  } else {
    signals.push({
      name: 'ranking',
      rawValue: input.ranking,
      normalizedScore: null,
      weight: 0.10,
      provenance: 'INSUFFICIENT_DATA',
      evidence: 'ranking not available',
    });
  }

  // ── Signal 5: listing growth (HEURISTIC, weight 0.10) ──────────────────
  if (input.listingGrowth !== null) {
    // Positive growth → higher demand proxy, but capped
    const norm = Math.max(0, Math.min(1, 0.5 + input.listingGrowth * 0.01));
    signals.push({
      name: 'listing_growth',
      rawValue: input.listingGrowth,
      normalizedScore: round4(D(norm)).toNumber(),
      weight: 0.10,
      provenance: 'HEURISTIC',
      evidence: `listing_growth=${input.listingGrowth} → normalized ${norm.toFixed(3)} (heuristic)`,
    });
    evidence.push(`HEURISTIC: listing_growth=${input.listingGrowth}`);
  } else {
    signals.push({
      name: 'listing_growth',
      rawValue: input.listingGrowth,
      normalizedScore: null,
      weight: 0.10,
      provenance: 'INSUFFICIENT_DATA',
      evidence: 'listing_growth not available',
    });
  }

  // ── Signal 6: seller count (HEURISTIC, weight 0.05) ────────────────────
  if (input.sellerCount !== null && input.sellerCount >= 0) {
    // More sellers = higher demand proxy (but also more competition)
    const norm = input.sellerCount > 0
      ? Math.min(1, Math.log10(input.sellerCount + 1) / 2)
      : 0;
    signals.push({
      name: 'seller_count',
      rawValue: input.sellerCount,
      normalizedScore: round4(D(norm)).toNumber(),
      weight: 0.05,
      provenance: 'HEURISTIC',
      evidence: `seller_count=${input.sellerCount} → normalized ${norm.toFixed(3)} (heuristic)`,
    });
    evidence.push(`HEURISTIC: seller_count=${input.sellerCount}`);
  } else {
    signals.push({
      name: 'seller_count',
      rawValue: input.sellerCount,
      normalizedScore: null,
      weight: 0.05,
      provenance: 'INSUFFICIENT_DATA',
      evidence: 'seller_count not available',
    });
  }

  // ── Aggregate: weighted sum over signals that have a score ──────────────
  let weightedSum = ZERO;
  let totalActiveWeight = ZERO;
  let observedCount = 0;
  for (const s of signals) {
    if (s.normalizedScore !== null) {
      weightedSum = weightedSum.plus(D(s.normalizedScore).times(D(s.weight)));
      totalActiveWeight = totalActiveWeight.plus(D(s.weight));
      if (s.provenance === 'OBSERVED') observedCount++;
    }
  }

  let demandScore: number | null;
  let demandClass: DemandClass;
  let demandConfidence: number;

  if (totalActiveWeight.isZero() || observedCount === 0) {
    // No OBSERVED signals at all → demand is UNKNOWN (not zero)
    demandScore = null;
    demandClass = 'UNKNOWN';
    demandConfidence = 0;
    evidence.push('INSUFFICIENT_DATA: no OBSERVED demand signals — demand is UNKNOWN (not fabricated)');
  } else {
    const score = weightedSum.div(totalActiveWeight);
    demandScore = round4(score).toNumber();
    demandClass = scoreToClass(demandScore);
    // Confidence: fraction of total weight that was active, boosted by OBSERVED signals
    const coverage = totalActiveWeight.div(D(1.0)).toNumber();
    const observedBoost = Math.min(1, observedCount * 0.3);
    demandConfidence = round4(D(Math.min(1, coverage * 0.6 + observedBoost))).toNumber();
  }

  // ── Trend from historical price observations ────────────────────────────
  const demandTrend = computeTrend(input.historicalPriceObservations);
  const demandVelocity = input.reviewVelocity;

  return {
    demandScore,
    demandConfidence,
    demandTrend,
    demandVelocity,
    demandClass,
    signals,
    methodology,
    timestamp,
    evidence,
  };
}

function scoreToClass(score: number): DemandClass {
  if (score >= 0.7) return 'HIGH';
  if (score >= 0.4) return 'MEDIUM';
  if (score >= 0.15) return 'LOW';
  return 'UNKNOWN';
}

/**
 * Infer demand trend from historical price observations.
 * Rising prices (in a competitive market) often signal rising demand.
 * This is a HEURISTIC — never presented as fact.
 */
function computeTrend(historicalPrices: number[]): DemandTrend {
  if (historicalPrices.length < 2) return 'UNKNOWN';
  const first = historicalPrices[0];
  const last = historicalPrices[historicalPrices.length - 1];
  if (first <= 0) return 'UNKNOWN';
  const change = (last - first) / first;
  if (change > 0.05) return 'RISING';
  if (change < -0.05) return 'DECLINING';
  return 'STABLE';
}
