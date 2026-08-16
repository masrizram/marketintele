/**
 * Product Matching Engine
 *
 * Matches marketplace-listed products against canonical product entities.
 *
 * Matching is based on multiple signals: SKU, barcode, brand+model, title similarity.
 * If confidence is insufficient, the match is NOT forced — DO NOT MATCH.
 *
 * IDEA.xml §35 (Product Matching), §43 (Matching Confidence).
 */
import { CanonicalProduct } from '../types';
import { ProductMatch, ProductMatchType } from '../core/models';
import { ulid } from 'ulid';

export interface MatchSignal {
  name: string;
  weight: number;
  score: number;        // 0-1
  evidence: string;
}

export interface MatchResult {
  matchType: ProductMatchType;
  matchScore: number;         // 0-1
  isVerified: boolean;
  signals: MatchSignal[];
  reason: string | null;
}

export interface MatchInput {
  marketplaceProduct: CanonicalProduct;
  canonicalProduct: CanonicalProduct;
}

/**
 * Compute Jaro-Winkler string similarity (0-1).
 * Used as a fallback when SKU/barcode don't match.
 */
function jaroWinkler(s1: string, s2: string): number {
  const s1Lower = s1.toLowerCase().trim();
  const s2Lower = s2.toLowerCase().trim();

  if (s1Lower === s2Lower) return 1.0;
  if (s1Lower.length === 0 || s2Lower.length === 0) return 0;

  // Simple Jaro-Winkler approximation
  const matchDistance = Math.floor(Math.max(s1Lower.length, s2Lower.length) / 2) - 1;
  const range = matchDistance < 0 ? 0 : matchDistance;

  const s1Matches = new Array(s1Lower.length).fill(false);
  const s2Matches = new Array(s2Lower.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1Lower.length; i++) {
    const start = Math.max(0, i - range);
    const end = Math.min(i + range + 1, s2Lower.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1Lower[i] !== s2Lower[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1Lower.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1Lower[i] !== s2Lower[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / s1Lower.length + matches / s2Lower.length + (matches - transpositions) / matches) / 3;

  // Winkler bonus for common prefix
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1Lower.length, s2Lower.length); i++) {
    if (s1Lower[i] === s2Lower[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Attempt to match a marketplace product against known canonical products.
 *
 * Returns the best match if confidence >= threshold, otherwise returns null
 * (DO NOT MATCH — forced matching is prohibited).
 */
export function matchProduct(
  marketplaceProduct: CanonicalProduct,
  candidates: CanonicalProduct[],
  threshold = 0.6,
): { match: MatchResult; canonicalProduct: CanonicalProduct | null } {
  if (candidates.length === 0) {
    return {
      match: {
        matchType: 'UNRELATED',
        matchScore: 0,
        isVerified: false,
        signals: [],
        reason: 'No canonical products to match against',
      },
      canonicalProduct: null,
    };
  }

  let bestMatch: MatchResult | null = null;
  let bestCandidate: CanonicalProduct | null = null;

  for (const candidate of candidates) {
    const result = computeMatchSignals(marketplaceProduct, candidate);

    if (!bestMatch || result.matchScore > bestMatch.matchScore) {
      bestMatch = result;
      bestCandidate = candidate;
    }
  }

  // DO NOT MATCH if confidence is below threshold
  if (bestMatch && bestMatch.matchScore < threshold) {
    return {
      match: {
        ...bestMatch,
        matchType: 'SIMILAR' as ProductMatchType,
        reason: `Match score ${bestMatch.matchScore.toFixed(3)} below threshold ${threshold} — DO NOT MATCH`,
      },
      canonicalProduct: null,
    };
  }

  return {
    match: bestMatch!,
    canonicalProduct: bestCandidate,
  };
}

/**
 * Compute individual match signals for a product pair.
 */
function computeMatchSignals(mp: CanonicalProduct, cp: CanonicalProduct): MatchResult {
  const signals: MatchSignal[] = [];
  let totalScore = 0;
  let totalWeight = 0;

  // Signal 1: Exact SKU match (weight 0.30)
  if (mp.sku && cp.sku && mp.sku === cp.sku) {
    signals.push({ name: 'sku_exact', weight: 0.30, score: 1.0, evidence: `SKU matches: ${mp.sku}` });
    totalScore += 0.30 * 1.0;
    totalWeight += 0.30;
  } else {
    signals.push({ name: 'sku_exact', weight: 0.30, score: 0, evidence: 'SKU mismatch or missing' });
    totalWeight += 0.30;
  }

  // Signal 2: Exact barcode match (weight 0.25)
  if (mp.barcode && cp.barcode && mp.barcode === cp.barcode) {
    signals.push({ name: 'barcode_exact', weight: 0.25, score: 1.0, evidence: `Barcode matches: ${mp.barcode}` });
    totalScore += 0.25 * 1.0;
    totalWeight += 0.25;
  } else {
    signals.push({ name: 'barcode_exact', weight: 0.25, score: 0, evidence: 'Barcode mismatch or missing' });
    totalWeight += 0.25;
  }

  // Signal 3: Brand + model match (weight 0.20)
  const brandMatch = mp.brand && cp.brand && mp.brand.toLowerCase() === cp.brand.toLowerCase();
  const modelMatch = mp.model && cp.model && mp.model.toLowerCase() === cp.model.toLowerCase();
  if (brandMatch && modelMatch) {
    signals.push({ name: 'brand_model', weight: 0.20, score: 1.0, evidence: `Brand "${mp.brand}" and model "${mp.model}" match` });
    totalScore += 0.20 * 1.0;
    totalWeight += 0.20;
  } else if (brandMatch) {
    signals.push({ name: 'brand_model', weight: 0.20, score: 0.5, evidence: `Brand "${mp.brand}" matches, model differs` });
    totalScore += 0.20 * 0.5;
    totalWeight += 0.20;
  } else {
    signals.push({ name: 'brand_model', weight: 0.20, score: 0, evidence: 'Brand mismatch' });
    totalWeight += 0.20;
  }

  // Signal 4: Title similarity (weight 0.15)
  const titleSim = jaroWinkler(mp.canonicalTitle, cp.canonicalTitle);
  signals.push({
    name: 'title_similarity',
    weight: 0.15,
    score: titleSim,
    evidence: `Title similarity: ${titleSim.toFixed(3)} ("${mp.canonicalTitle}" vs "${cp.canonicalTitle}")`,
  });
  totalScore += 0.15 * titleSim;
  totalWeight += 0.15;

  // Signal 5: Price consistency (weight 0.10)
  if (mp.priceInIdr !== null && cp.priceInIdr !== null) {
    const priceRatio = Math.min(mp.priceInIdr!, cp.priceInIdr!) / Math.max(mp.priceInIdr!, cp.priceInIdr!);
    // If prices are within 50% of each other, it's a reasonable match
    const priceScore = priceRatio >= 0.5 ? 1.0 : priceRatio;
    signals.push({
      name: 'price_consistency',
      weight: 0.10,
      score: priceScore,
      evidence: `Price ratio: ${priceRatio.toFixed(3)} (${mp.priceInIdr} vs ${cp.priceInIdr})`,
    });
    totalScore += 0.10 * priceScore;
    totalWeight += 0.10;
  } else {
    signals.push({
      name: 'price_consistency',
      weight: 0.10,
      score: 0,
      evidence: 'Price unknown on one side — cannot validate consistency',
    });
    totalWeight += 0.10;
  }

  const matchScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  // Determine match type based on score
  let matchType: ProductMatchType = 'UNRELATED';
  if (matchScore >= 0.9) matchType = 'EXACT_SAME_PRODUCT';
  else if (matchScore >= 0.75) matchType = 'SAME_PRODUCT_DIFFERENT_VARIANT';
  else if (matchScore >= 0.6) matchType = 'SAME_PRODUCT_DIFFERENT_PACKAGE';
  else if (matchScore >= 0.4) matchType = 'SIMILAR';
  else matchType = 'UNRELATED';

  // For exact match, require SKU or barcode
  if (matchType === 'EXACT_SAME_PRODUCT') {
    const hasId = (mp.sku && cp.sku && mp.sku === cp.sku) || (mp.barcode && cp.barcode && mp.barcode === cp.barcode);
    if (!hasId) {
      matchType = 'SIMILAR';
    }
  }

  return {
    matchType,
    matchScore,
    isVerified: matchType === 'EXACT_SAME_PRODUCT' || matchType === 'SAME_PRODUCT_DIFFERENT_VARIANT',
    signals,
    reason: null,
  };
}

/**
 * Create a ProductMatch record for persistence.
 */
export function createProductMatch(
  productId: string,
  supplierProductId: string,
  result: MatchResult,
): ProductMatch {
  return {
    id: ulid(),
    productId,
    supplierProductId,
    matchType: result.matchType,
    matchScore: result.matchScore,
    isVerified: result.isVerified,
    matchSignalsJson: JSON.stringify(result.signals),
    createdAt: new Date(),
  };
}
