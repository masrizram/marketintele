/**
 * Comprehensive Risk Engine — 11 dimensions (IDEA.md §27 / AUDIT §27)
 *
 * Dimensions: supplier_risk, product_risk, market_risk, competition_risk,
 * price_risk, demand_risk, operational_risk, regulatory_risk,
 * data_quality_risk, staleness_risk, execution_risk.
 *
 * Each dimension: risk_score (0-1), confidence, evidence, mitigation.
 * Overall = weighted max of critical dimensions (fail-closed).
 * Risk MUST influence EV, opportunity score, decision, ranking, alert priority.
 */
import { D, round4 } from '../economic/decimal-engine';
import { RiskAssessment, RiskLevel } from '../pipeline/types';
import { DemandResult } from './demand';
import { CompetitionResult } from './competition';
import { DecayResult } from './opportunity-decay';
import { SupplierSource, EconomicResult } from '../pipeline/types';
import { CanonicalProduct } from '../types';

export interface RiskDimension {
  name: string;
  score: number;          // 0-1 (1 = worst risk)
  confidence: number;      // 0-1
  level: RiskLevel;
  evidence: string;
  mitigation: string;
}

export interface ComprehensiveRiskInput {
  product: CanonicalProduct;
  supplier: SupplierSource;
  economics: EconomicResult;
  demand: DemandResult | null;
  competition: CompetitionResult | null;
  decay: DecayResult | null;
  marketplace: string;
  requestId: string;
}

export interface ComprehensiveRiskResult {
  overallRisk: RiskLevel;
  overallScore: number;
  confidenceScore: number;
  dimensions: RiskDimension[];
  evidence: string[];
  factors: RiskAssessment['factors'];
}

/** Weights for each dimension (sum = 1.0).  Critical dimensions weighted higher. */
const DIMENSION_WEIGHTS: Record<string, number> = {
  supplier_risk: 0.18,
  product_risk: 0.10,
  market_risk: 0.10,
  competition_risk: 0.08,
  price_risk: 0.10,
  demand_risk: 0.08,
  operational_risk: 0.10,
  regulatory_risk: 0.06,
  data_quality_risk: 0.08,
  staleness_risk: 0.07,
  execution_risk: 0.05,
};

export function assessComprehensiveRisk(input: ComprehensiveRiskInput): ComprehensiveRiskResult {
  const dimensions: RiskDimension[] = [];
  const evidence: string[] = [];
  const { product, supplier, economics, demand, competition, decay } = input;

  const scoreToLevel = (s: number): RiskLevel => {
    if (s >= 0.6) return 'CRITICAL';
    if (s >= 0.4) return 'HIGH';
    if (s >= 0.2) return 'MEDIUM';
    return 'LOW';
  };

  // ── 1. Supplier risk ────────────────────────────────────────────────────
  let supplierScore = 0;
  if (supplier.confidence === 'UNKNOWN') supplierScore += 0.5;
  else if (supplier.confidence === 'PARTIALLY_VERIFIED') supplierScore += 0.25;
  else if (supplier.confidence === 'UNVERIFIED') supplierScore += 0.4;
  if (supplier.confidenceScore < 0.3) supplierScore = Math.max(supplierScore, 0.4);
  if (supplier.sourcePriceIdr === null) supplierScore += 0.3;
  if (supplier.shippingCostIdr === null) supplierScore += 0.2;
  supplierScore = Math.min(1, supplierScore);
  dimensions.push({
    name: 'supplier_risk',
    score: round4(D(supplierScore)).toNumber(),
    confidence: supplier.confidenceScore,
    level: scoreToLevel(supplierScore),
    evidence: `supplier confidence=${supplier.confidence}, priceKnown=${supplier.sourcePriceIdr !== null}, shippingKnown=${supplier.shippingCostIdr !== null}`,
    mitigation: 'Verify supplier identity via B2B directory; obtain quotation + shipping quote',
  });

  // ── 2. Product risk ──────────────────────────────────────────────────────
  let productScore = 0;
  if (product.confidence < 0.3) productScore += 0.4;
  else if (product.confidence < 0.5) productScore += 0.2;
  if (product.priceInIdr === null) productScore += 0.5;
  if (product.barcode === null && product.sku === null) productScore += 0.15;
  productScore = Math.min(1, productScore);
  dimensions.push({
    name: 'product_risk',
    score: round4(D(productScore)).toNumber(),
    confidence: product.confidence,
    level: scoreToLevel(productScore),
    evidence: `product confidence=${product.confidence}, priceKnown=${product.priceInIdr !== null}, hasId=${product.barcode !== null || product.sku !== null}`,
    mitigation: 'Obtain GTIN/barcode; verify product specifications from manufacturer',
  });

  // ── 3. Market risk ──────────────────────────────────────────────────────
  let marketScore = 0;
  if (economics.profitCalculation) {
    const margin = economics.profitCalculation.primaryResult.netMarginPercent.toNumber();
    if (margin < 5) marketScore += 0.3;
    else if (margin < 15) marketScore += 0.15;
  } else {
    marketScore += 0.4; // no profit calc = high market uncertainty
  }
  marketScore = Math.min(1, marketScore);
  dimensions.push({
    name: 'market_risk',
    score: round4(D(marketScore)).toNumber(),
    confidence: economics.profitCalculation ? 0.7 : 0.3,
    level: scoreToLevel(marketScore),
    evidence: `profit computed=${economics.profitCalculation !== null}`,
    mitigation: 'Monitor market price daily; set stop-loss threshold',
  });

  // ── 4. Competition risk ──────────────────────────────────────────────────
  let compScore = 0;
  if (competition) {
    if (competition.competitionScore !== null) {
      compScore = competition.competitionScore * 0.6;
    }
    if (competition.priceWarProbability !== null && competition.priceWarProbability > 0.4) {
      compScore += 0.3;
    }
  } else {
    compScore = 0.4; // unknown competition = moderate-high risk
  }
  compScore = Math.min(1, compScore);
  dimensions.push({
    name: 'competition_risk',
    score: round4(D(compScore)).toNumber(),
    confidence: competition ? 0.7 : 0.3,
    level: scoreToLevel(compScore),
    evidence: competition
      ? `competition_score=${competition.competitionScore}, price_war_prob=${competition.priceWarProbability}`
      : 'competition data unavailable',
    mitigation: 'Scan competitors before scaling; track undercutting',
  });

  // ── 5. Price risk ────────────────────────────────────────────────────────
  let priceScore = 0;
  if (competition && competition.priceStability !== null) {
    priceScore = round4(D(1 - competition.priceStability)).toNumber();
  } else {
    priceScore = 0.3;
  }
  dimensions.push({
    name: 'price_risk',
    score: round4(D(priceScore)).toNumber(),
    confidence: competition ? 0.6 : 0.3,
    level: scoreToLevel(priceScore),
    evidence: competition
      ? `price_stability=${competition.priceStability}`
      : 'price stability unknown',
    mitigation: 'Use conservative (P25) clearing price; set price-drop alert',
  });

  // ── 6. Demand risk ──────────────────────────────────────────────────────
  let demandScore = 0;
  if (demand) {
    if (demand.demandScore === null) {
      demandScore = 0.4; // unknown demand
    } else if (demand.demandScore < 0.3) {
      demandScore = 0.3;
    } else if (demand.demandClass === 'HIGH') {
      demandScore = 0.05;
    }
    if (demand.demandConfidence < 0.4) demandScore += 0.15;
  } else {
    demandScore = 0.4;
  }
  demandScore = Math.min(1, demandScore);
  dimensions.push({
    name: 'demand_risk',
    score: round4(D(demandScore)).toNumber(),
    confidence: demand ? demand.demandConfidence : 0.2,
    level: scoreToLevel(demandScore),
    evidence: demand
      ? `demand_score=${demand.demandScore}, class=${demand.demandClass}, conf=${demand.demandConfidence}`
      : 'demand data unavailable',
    mitigation: 'Start with test order; verify sales velocity before scaling',
  });

  // ── 7. Operational risk ─────────────────────────────────────────────────
  let opScore = 0.15; // baseline cross-border operational risk
  if (supplier.shippingCostIdr === null) opScore += 0.2;
  if (economics.landedCost === null) opScore += 0.25;
  opScore = Math.min(1, opScore);
  dimensions.push({
    name: 'operational_risk',
    score: round4(D(opScore)).toNumber(),
    confidence: 0.5,
    level: scoreToLevel(opScore),
    evidence: `shippingKnown=${supplier.shippingCostIdr !== null}, landedCostKnown=${economics.landedCost !== null}`,
    mitigation: 'Use insured freight forwarder; pre-clear customs',
  });

  // ── 8. Regulatory risk ───────────────────────────────────────────────────
  // Cross-border import to Indonesia: BPOM/SNI compliance, customs regulations
  let regScore = 0.15;
  if (product.categoryId === null) regScore += 0.1; // unknown category = unknown regulatory requirements
  dimensions.push({
    name: 'regulatory_risk',
    score: round4(D(regScore)).toNumber(),
    confidence: 0.3,
    level: scoreToLevel(regScore),
    evidence: 'cross-border import to Indonesia; BPOM/SNI/customs compliance required',
    mitigation: 'Verify HS code, SNI certification, BPOM registration if applicable',
  });

  // ── 9. Data quality risk ────────────────────────────────────────────────
  let dqScore = 0;
  if (product.confidence < 0.4) dqScore += 0.3;
  if (product.dataLineage.evidenceHierarchyLevel >= 5) dqScore += 0.2;
  if (demand && demand.demandConfidence < 0.3) dqScore += 0.15;
  dqScore = Math.min(1, dqScore);
  dimensions.push({
    name: 'data_quality_risk',
    score: round4(D(dqScore)).toNumber(),
    confidence: 0.6,
    level: scoreToLevel(dqScore),
    evidence: `product_confidence=${product.confidence}, evidence_level=${product.dataLineage.evidenceHierarchyLevel}`,
    mitigation: 'Collect additional evidence; cross-reference multiple sources',
  });

  // ── 10. Staleness risk ───────────────────────────────────────────────────
  let staleScore = 0;
  if (decay) {
    if (decay.staleCriticalData) {
      staleScore = 0.5;
    } else if (decay.freshness === 'STALE') {
      staleScore = 0.3;
    } else if (decay.freshness === 'AGING') {
      staleScore = 0.15;
    } else if (decay.freshness === 'EXPIRED') {
      staleScore = 0.7;
    }
  } else {
    staleScore = 0.25; // unknown freshness
  }
  dimensions.push({
    name: 'staleness_risk',
    score: round4(D(staleScore)).toNumber(),
    confidence: decay ? 0.7 : 0.3,
    level: scoreToLevel(staleScore),
    evidence: decay
      ? `freshness=${decay.freshness}, staleCritical=${decay.staleCriticalData}, age=${decay.opportunityAgeHours}h`
      : 'decay data unavailable',
    mitigation: 'Re-fetch fresh data before economic decision; enforce TTL',
  });

  // ── 11. Execution risk ──────────────────────────────────────────────────
  let execScore = 0.1;
  if (supplier.moq === null) execScore += 0.2;
  if (supplier.type === 'UNKNOWN') execScore += 0.15;
  execScore = Math.min(1, execScore);
  dimensions.push({
    name: 'execution_risk',
    score: round4(D(execScore)).toNumber(),
    confidence: 0.4,
    level: scoreToLevel(execScore),
    evidence: `moqKnown=${supplier.moq !== null}, supplierType=${supplier.type}`,
    mitigation: 'Confirm MOQ, lead time, payment terms with supplier',
  });

  // ── Aggregate: weighted sum + critical-dimension max ───────────────────
  let weightedSum = 0;
  let totalWeight = 0;
  let criticalMax = 0;
  for (const dim of dimensions) {
    const w = DIMENSION_WEIGHTS[dim.name] || 0.05;
    weightedSum += dim.score * w;
    totalWeight += w;
    if (dim.level === 'CRITICAL') {
      criticalMax = Math.max(criticalMax, dim.score);
    }
  }
  // Overall = max(weighted average, critical dimension) — fail-closed
  const overallScore = Math.max(weightedSum / totalWeight, criticalMax);
  const overallRisk = scoreToLevel(overallScore);
  const confidenceScore = Math.max(0, 1 - overallScore);

  dimensions.forEach((d) => evidence.push(`${d.name}: ${d.score} (${d.level}) — ${d.evidence}`));

  return {
    overallRisk,
    overallScore: round4(D(overallScore)).toNumber(),
    confidenceScore: round4(D(confidenceScore)).toNumber(),
    dimensions,
    evidence,
    factors: {
      supplierUnverified: supplier.confidence === 'UNKNOWN' || supplier.confidence === 'UNVERIFIED',
      dataFreshnessHours: decay?.opportunityAgeHours ?? null,
      priceVolatility: competition?.priceDispersion ?? null,
      priceWarRisk: competition?.priceWarRisk === 'HIGH' || competition?.priceWarRisk === 'MEDIUM',
      counterfeitRisk: supplier.confidence !== 'VERIFIED',
      operationalRisk: true,
      singleSupplier: true,
      lowDemandConfidence: demand ? demand.demandConfidence < 0.3 : true,
    },
  };
}
