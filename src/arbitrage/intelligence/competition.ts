/**
 * Competition Intelligence Engine
 *
 * IDEA.md §19 / AUDIT §26 require: seller_count, seller_concentration (HHI),
 * top_seller_dominance, price_dispersion, lowest_price, price-war detection,
 * and a competition_score / competition_level / price_war_risk.
 *
 * IDEA.md §20: market_saturation_score must NOT assume HIGH_DEMAND = GOOD.
 *
 * All metrics derive from actual listing data.  When data is insufficient,
 * outputs are UNKNOWN / null — never fabricated.
 */
import { D, ZERO, round4 } from '../economic/decimal-engine';
import { MarketListing } from './market-clearing';
import { coefficientOfVariation, computeHHI } from './market-clearing';

export type CompetitionLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' | 'UNKNOWN';
export type PriceWarRisk = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';

export interface CompetitionInput {
  listings: MarketListing[];
  /** Price-change frequency observations per seller (changes per period). */
  priceChangeFrequency: number | null;
  /** 7-day undercutting observations: did sellers cut prices recently? */
  recentUndercutCount: number | null;
  observedAt: string;
}

export interface CompetitionResult {
  sellerCount: number | null;
  activeSellerCount: number | null;
  sellerConcentration: number | null;   // HHI normalised 0-1
  topSellerDominance: number | null;     // top seller's market share 0-1
  priceDispersion: number | null;        // coefficient of variation
  lowestPrice: number | null;
  competitionScore: number | null;       // 0-1 (1 = extreme competition)
  competitionLevel: CompetitionLevel;
  priceWarRisk: PriceWarRisk;
  priceWarProbability: number | null;    // 0-1
  marketSaturationScore: number | null;  // 0-1
  priceStability: number | null;          // 0-1 (1 = very stable)
  evidence: string[];
  methodology: string;
  timestamp: string;
}

export function assessCompetition(input: CompetitionInput): CompetitionResult {
  const timestamp = new Date().toISOString();
  const methodology =
    'HHI seller concentration + top-seller share + CV price dispersion + ' +
    'undercutting signals → competition_score (0-1).  Saturation from seller ' +
    'density + price compression.  Price-war probability from undercutting ' +
    'frequency + dispersion + seller count.  Data-driven; insufficient → UNKNOWN.';
  const evidence: string[] = [];

  const valid = input.listings.filter(
    (l) => l.price !== null && l.price > 0 && Number.isFinite(l.price),
  );

  if (valid.length === 0) {
    return {
      sellerCount: null,
      activeSellerCount: null,
      sellerConcentration: null,
      topSellerDominance: null,
      priceDispersion: null,
      lowestPrice: null,
      competitionScore: null,
      competitionLevel: 'UNKNOWN',
      priceWarRisk: 'UNKNOWN',
      priceWarProbability: null,
      marketSaturationScore: null,
      priceStability: null,
      evidence: ['INSUFFICIENT_DATA: no valid listings for competition analysis'],
      methodology,
      timestamp,
    };
  }

  const prices = valid.map((l) => l.price);
  const { hhi, sellerCount } = computeHHI(valid);
  const dispersion = coefficientOfVariation(prices);
  const lowestPrice = Math.min(...prices);

  // Top seller dominance: largest seller's share
  const sellerShares = new Map<string, number>();
  let totalWeight = 0;
  for (const l of valid) {
    const w = l.reviewCount !== null && l.reviewCount > 0 ? l.reviewCount : 1;
    const key = l.sellerId || l.sellerName || 'unknown';
    sellerShares.set(key, (sellerShares.get(key) || 0) + w);
    totalWeight += w;
  }
  const topDominance = totalWeight > 0
    ? round4(D(Math.max(...Array.from(sellerShares.values()))).div(totalWeight)).toNumber()
    : null;

  // Price stability: inverse of dispersion (clamped 0-1)
  const priceStability = dispersion !== null
    ? round4(D(Math.max(0, 1 - dispersion))).toNumber()
    : null;

  // Competition score: high seller count + high dispersion + low concentration = high competition
  // (many fragmented sellers with price spread = competitive market)
  const sellerDensityScore = Math.min(1, Math.log10(sellerCount + 1) / 2);
  const concentrationScore = hhi; // higher HHI = less competition (monopoly)
  const dispersionScore = Math.min(1, dispersion * 2);
  // Competition = density + dispersion - concentration (monopolies have low competition)
  const competitionScore = round4(
    D(Math.max(0, Math.min(1, sellerDensityScore * 0.4 + dispersionScore * 0.4 - concentrationScore * 0.3 + 0.25))),
  ).toNumber();

  const competitionLevel: CompetitionLevel = scoreToCompetitionLevel(competitionScore);

  // Price-war probability: driven by undercutting + dispersion + seller count
  let priceWarProb = ZERO;
  if (input.recentUndercutCount !== null && input.recentUndercutCount > 0) {
    const undercutScore = Math.min(1, input.recentUndercutCount / 5);
    priceWarProb = priceWarProb.plus(D(undercutScore).times(0.5));
    evidence.push(`OBSERVED: recent_undercut_count=${input.recentUndercutCount}`);
  }
  if (dispersion > 0.2) {
    priceWarProb = priceWarProb.plus(D(0.2));
  }
  if (sellerCount > 10) {
    priceWarProb = priceWarProb.plus(D(0.15));
  }
  if (input.priceChangeFrequency !== null && input.priceChangeFrequency > 2) {
    priceWarProb = priceWarProb.plus(D(0.15));
    evidence.push(`OBSERVED: price_change_frequency=${input.priceChangeFrequency}`);
  }
  const priceWarProbability = round4(D(Math.min(1, priceWarProb.toNumber()))).toNumber();
  const priceWarRisk = probabilityToRisk(priceWarProbability);

  // Market saturation: seller density + price compression (low dispersion = saturated)
  const stabilityComponent = priceStability !== null ? (1 - priceStability) * 0.3 : 0.1;
  const saturationScore = round4(
    D(Math.max(0, Math.min(1, sellerDensityScore * 0.5 + stabilityComponent + (hhi < 0.3 ? 0.2 : 0)))),
  ).toNumber();

  evidence.push(`seller_count=${sellerCount}, HHI=${hhi}, CV=${dispersion}, lowest=${lowestPrice}`);
  evidence.push(`competition_score=${competitionScore}, level=${competitionLevel}`);
  evidence.push(`price_war_probability=${priceWarProbability}, risk=${priceWarRisk}`);
  evidence.push(`saturation=${saturationScore}, stability=${priceStability}`);

  return {
    sellerCount,
    activeSellerCount: sellerCount, // all sellers with active listings
    sellerConcentration: hhi,
    topSellerDominance: topDominance,
    priceDispersion: dispersion,
    lowestPrice,
    competitionScore,
    competitionLevel,
    priceWarRisk,
    priceWarProbability,
    marketSaturationScore: saturationScore,
    priceStability,
    evidence,
    methodology,
    timestamp,
  };
}

function scoreToCompetitionLevel(score: number): CompetitionLevel {
  if (score >= 0.8) return 'EXTREME';
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.35) return 'MEDIUM';
  if (score >= 0.15) return 'LOW';
  return 'UNKNOWN';
}

function probabilityToRisk(prob: number): PriceWarRisk {
  if (prob >= 0.7) return 'HIGH';
  if (prob >= 0.4) return 'MEDIUM';
  if (prob >= 0.15) return 'LOW';
  return 'NONE';
}
