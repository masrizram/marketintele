/**
 * Opportunity Decay / Half-Life Engine
 *
 * IDEA.md §31 / AUDIT §31 require: opportunity_age, decay_rate, half_life,
 * freshness, price_change_velocity, supplier_price_change_velocity,
 * competition_change_velocity, opportunity_valid_now, estimated_expiry.
 *
 * An opportunity that was profitable 24 hours ago MUST NOT automatically be
 * treated as profitable now.  Stale opportunities decay and eventually
 * expire (BLOCK economic decision per IDEA §30).
 *
 * UNKNOWN != ZERO: when observation timestamps are missing, decay cannot
 * be computed and `opportunity_valid_now` is UNKNOWN (not assumed valid).
 */
import { D, round4 } from '../economic/decimal-engine';

export type FreshnessStatus = 'FRESH' | 'AGING' | 'STALE' | 'EXPIRED' | 'UNKNOWN';

export interface DecayInput {
  /** When the opportunity was first discovered (ISO-8601). */
  discoveredAt: string | null;
  /** When the key price data was last observed (ISO-8601). */
  lastPriceObservedAt: string | null;
  /** When supplier price was last verified (ISO-8601). */
  lastSupplierVerifiedAt: string | null;
  /** Current time reference (ISO-8601). Defaults to now. */
  now: string | null;
  /** Half-life in hours (how fast the opportunity decays). Default: 24h. */
  halfLifeHours: number;
  /** Price change velocity — how fast market price is moving (IDR/hour). */
  priceChangeVelocity: number | null;
  /** Supplier price change velocity (IDR/hour). */
  supplierPriceChangeVelocity: number | null;
  /** Competition change velocity (new sellers/hour or similar). */
  competitionChangeVelocity: number | null;
  /** TTL per data class (ISO-8601 durations) — overrides defaults. */
  marketPriceTtlHours: number;
  supplierPriceTtlHours: number;
}

export interface DecayResult {
  opportunityAgeHours: number | null;
  decayFactor: number | null;          // 0-1 (1 = fresh, 0 = fully decayed)
  halfLifeHours: number;
  freshness: FreshnessStatus;
  priceChangeVelocity: number | null;
  supplierPriceChangeVelocity: number | null;
  competitionChangeVelocity: number | null;
  opportunityValidNow: boolean | null; // null = UNKNOWN (cannot determine)
  estimatedExpiryHours: number | null; // hours until fully decayed
  staleCriticalData: boolean;           // true if mandatory price data is stale
  evidence: string[];
  methodology: string;
  timestamp: string;
}

/**
 * Compute opportunity decay using exponential half-life.
 *
 *   decayFactor = 0.5 ^ (age / halfLife)
 *
 * A stale mandatory price (beyond its TTL) forces `staleCriticalData = true`,
 * which downstream MUST block economic decisions (IDEA §30).
 */
export function computeOpportunityDecay(input: DecayInput): DecayResult {
  const now = input.now ? new Date(input.now) : new Date();
  const timestamp = now.toISOString();
  const methodology =
    `Exponential decay: factor = 0.5^(age/halfLife), halfLife=${input.halfLifeHours}h. ` +
    `Freshness from age + TTL enforcement. Stale mandatory price → staleCriticalData=true → BLOCK. ` +
    `UNKNOWN when timestamps missing.`;
  const evidence: string[] = [];

  // ── Opportunity age ────────────────────────────────────────────────────
  let opportunityAgeHours: number | null = null;
  if (input.discoveredAt) {
    const discovered = new Date(input.discoveredAt);
    if (!isNaN(discovered.getTime())) {
      opportunityAgeHours = (now.getTime() - discovered.getTime()) / (1000 * 60 * 60);
      evidence.push(`opportunity_age = ${opportunityAgeHours.toFixed(1)}h`);
    }
  }
  if (opportunityAgeHours === null) {
    evidence.push('opportunity_age UNKNOWN — discoveredAt missing/invalid');
  }

  // ── Decay factor (exponential half-life) ────────────────────────────────
  let decayFactor: number | null = null;
  if (opportunityAgeHours !== null && input.halfLifeHours > 0) {
    const exponent = opportunityAgeHours / input.halfLifeHours;
    decayFactor = round4(D(Math.pow(0.5, exponent))).toNumber();
    evidence.push(`decay_factor = 0.5^${exponent.toFixed(3)} = ${decayFactor}`);
  }

  // ── Freshness status ─────────────────────────────────────────────────────
  let freshness: FreshnessStatus = 'UNKNOWN';
  if (opportunityAgeHours !== null) {
    const quarterLife = input.halfLifeHours / 4;
    const halfLife = input.halfLifeHours;
    const doubleLife = input.halfLifeHours * 2;
    if (opportunityAgeHours <= quarterLife) freshness = 'FRESH';
    else if (opportunityAgeHours <= halfLife) freshness = 'AGING';
    else if (opportunityAgeHours <= doubleLife) freshness = 'STALE';
    else freshness = 'EXPIRED';
    evidence.push(`freshness = ${freshness} (age ${opportunityAgeHours.toFixed(1)}h vs halfLife ${halfLife}h)`);
  }

  // ── Stale critical data detection (TTL enforcement) ──────────────────────
  let staleCriticalData = false;
  if (input.lastPriceObservedAt) {
    const observed = new Date(input.lastPriceObservedAt);
    if (!isNaN(observed.getTime())) {
      const ageHours = (now.getTime() - observed.getTime()) / (1000 * 60 * 60);
      if (ageHours > input.marketPriceTtlHours) {
        staleCriticalData = true;
        evidence.push(`STALE: market price ${ageHours.toFixed(1)}h old > TTL ${input.marketPriceTtlHours}h`);
      } else {
        evidence.push(`market price fresh: ${ageHours.toFixed(1)}h <= TTL ${input.marketPriceTtlHours}h`);
      }
    }
  } else {
    staleCriticalData = true;
    evidence.push('STALE: market price observation timestamp missing');
  }

  if (input.lastSupplierVerifiedAt) {
    const verified = new Date(input.lastSupplierVerifiedAt);
    if (!isNaN(verified.getTime())) {
      const ageHours = (now.getTime() - verified.getTime()) / (1000 * 60 * 60);
      if (ageHours > input.supplierPriceTtlHours) {
        staleCriticalData = true;
        evidence.push(`STALE: supplier price ${ageHours.toFixed(1)}h old > TTL ${input.supplierPriceTtlHours}h`);
      }
    }
  } else {
    // Supplier price unknown is handled elsewhere (fail-closed at economics).
    // Missing supplier verification timestamp is a warning, not a stale block,
    // because the supplier cost may simply be UNKNOWN (not stale).
    evidence.push('supplier verification timestamp missing (supplier cost may be UNKNOWN, not stale)');
  }

  // ── Opportunity valid now ────────────────────────────────────────────────
  // null = UNKNOWN when we cannot determine validity (missing timestamps).
  let opportunityValidNow: boolean | null = null;
  if (decayFactor !== null) {
    opportunityValidNow = decayFactor > 0.1 && !staleCriticalData;
    evidence.push(`opportunity_valid_now = ${opportunityValidNow} (decay>${0.1} && !staleCritical)`);
  } else {
    evidence.push('opportunity_valid_now = UNKNOWN (cannot determine without age)');
  }

  // ── Estimated expiry ─────────────────────────────────────────────────────
  // Time until decay factor drops below 0.01 (effectively dead).
  let estimatedExpiryHours: number | null = null;
  if (input.halfLifeHours > 0) {
    // 0.5^(x/halfLife) < 0.01 → x/halfLife > log(0.01)/log(0.5) ≈ 6.64
    estimatedExpiryHours = round4(D(input.halfLifeHours * 6.64)).toNumber();
    if (opportunityAgeHours !== null) {
      estimatedExpiryHours = round4(D(Math.max(0, estimatedExpiryHours - opportunityAgeHours))).toNumber();
    }
    evidence.push(`estimated_expiry in ~${estimatedExpiryHours}h`);
  }

  return {
    opportunityAgeHours,
    decayFactor,
    halfLifeHours: input.halfLifeHours,
    freshness,
    priceChangeVelocity: input.priceChangeVelocity,
    supplierPriceChangeVelocity: input.supplierPriceChangeVelocity,
    competitionChangeVelocity: input.competitionChangeVelocity,
    opportunityValidNow,
    estimatedExpiryHours,
    staleCriticalData,
    evidence,
    methodology,
    timestamp,
  };
}
