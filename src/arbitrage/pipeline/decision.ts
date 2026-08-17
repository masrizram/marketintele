/**
 * Opportunity Decision Engine
 *
 * Takes the economic result and risk assessment, applies all 15 validation
 * gates from IDEA.xml §9 (ValidationGate C01-C15), and produces a final
 * RECOMMEND / REVIEW / REJECT decision.
 *
 * Gate enforcement per IDEA.xml:
 *   CRITICAL_FAIL -> REJECT
 *   CRITICAL_UNKNOWN -> DO_NOT_RECOMMEND
 *   WARNING_NON_CRITICAL -> RECOMMEND_WITH_EXPLICIT_WARNING
 *   ALL_CRITICAL_PASS -> VERIFIED_OPPORTUNITY
 *
 * A positive profit does NOT automatically mean RECOMMEND.
 * Critical gate failures block false-positive recommendations.
 */
import { CanonicalProduct } from '../types';
import { EconomicResult, RiskAssessment, OpportunityResult, OpportunityDecision } from './types';
import { createRequestLogger } from './logger';
import { CONFIDENCE_FLOOR } from '../lib/constants';
import { computeFreshnessStatus, MAX_MARKETPLACE_OBSERVATION_AGE_HOURS, isProductionEligibleProvenance } from '../provenance/data-provenance';
import type { MarketClearingPriceResult } from '../intelligence/market-clearing';
import type { DemandResult } from '../intelligence/demand';
import type { CompetitionResult } from '../intelligence/competition';
import type { DecayResult } from '../intelligence/opportunity-decay';
import type { EVResult } from '../intelligence/expected-value';

// ─── Gate IDs from IDEA.xml §9 ──────────────────────────────────────────────

export interface DecisionInput {
  product: CanonicalProduct;
  marketplace: string;
  economics: EconomicResult;
  risk: RiskAssessment;
  requestId: string;
  /** Market clearing price from multi-listing aggregation (IDEA §16). */
  marketClearingPrice?: MarketClearingPriceResult | null;
  /** Demand intelligence (IDEA §18). */
  demand?: DemandResult | null;
  /** Competition intelligence (IDEA §19). */
  competition?: CompetitionResult | null;
  /** Opportunity decay/half-life (IDEA §31). */
  decay?: DecayResult | null;
  /** Expected value (IDEA §26). */
  expectedValue?: EVResult | null;
}

export interface GateResult {
  id: string;              // C01, C02, etc. per IDEA.xml
  name: string;
  passed: boolean;
  critical: boolean;
  detail: string;
}

/**
 * Apply all 15 validation gates (C01-C15) and produce an opportunity decision.
 *
 * Gate mapping per IDEA.xml §9:
 * C01 PRODUCT_IDENTITY_VERIFIED (CRITICAL)
 * C02 SUPPLIER_IDENTITY_VERIFIED (CRITICAL)
 * C03 UNIT_PACKAGE_EQUIVALENCE_CONFIRMED (CRITICAL)
 * C04 PRICE_AND_MOQ_VALIDITY (CRITICAL)
 * C05 MARKETPLACE_COMPARABILITY_EXACT (CRITICAL)
 * C06 MARKET_CLEARING_PRICE_CALCULATED (CRITICAL)
 * C07 LANDED_COST_COMPLETE_NO_UNKNOWN (CRITICAL)
 * C08 MARKETPLACE_FEES_FULLY_CONFIGURED (CRITICAL)
 * C09 INDEPENDENT_PROFIT_CALCULATION_MATCH (CRITICAL)
 * C10 DEMAND_EVIDENCE_SUFFICIENT (non-critical)
 * C11 COMPETITION_SATURATION_ACCEPTABLE (non-critical)
 * C12 RISK_THRESHOLDS_WITHIN_BOUNDS (CRITICAL)
 * C13 DATA_FRESHNESS_WITHIN_TTL (CRITICAL)
 * C14 SENSITIVITY_ROBUSTNESS_PASS (CRITICAL)
 * C15 CONFIDENCE_SCORE_ABOVE_FLOOR (CRITICAL)
 */
export function decideOpportunity(input: DecisionInput): OpportunityResult {
  const { product, economics, risk, requestId } = input;
  const reqLogger = createRequestLogger(requestId);

  const gates: GateResult[] = [];
  const evidence: string[] = [];

  // ─── C01: PRODUCT_IDENTITY_VERIFIED (CRITICAL) ─────────────────────────────
  const hasProductIdentity = product.brand !== null && product.barcode !== null;
  gates.push({
    id: 'C01',
    name: 'Product Identity Verified',
    passed: hasProductIdentity,
    critical: true,
    detail: `brand=${product.brand}, barcode=${product.barcode}`,
  });
  if (hasProductIdentity) {
    evidence.push('Product identity verified (brand + barcode present)');
  } else {
    evidence.push(`Product identity incomplete — brand=${product.brand}, barcode=${product.barcode}`);
  }

  // ─── C02: SUPPLIER_IDENTITY_VERIFIED (CRITICAL) ────────────────────────────
  const supplierVerified = risk.factors.supplierUnverified === false && risk.overallRisk !== 'CRITICAL';
  gates.push({
    id: 'C02',
    name: 'Supplier Identity Verified',
    passed: supplierVerified,
    critical: true,
    detail: `supplierUnverified=${risk.factors.supplierUnverified}, overallRisk=${risk.overallRisk}`,
  });
  if (supplierVerified) {
    evidence.push('Supplier identity verified');
  } else {
    evidence.push('Supplier identity NOT fully verified');
  }

  // ─── C03: UNIT_PACKAGE_EQUIVALENCE_CONFIRMED (CRITICAL) ────────────────────
  // Package quantity must be known and comparable
  const packageEquivalent = product.packageQuantity !== null && product.packageQuantity >= 1;
  gates.push({
    id: 'C03',
    name: 'Unit/Package Equivalence Confirmed',
    passed: packageEquivalent,
    critical: true,
    detail: `packageQuantity=${product.packageQuantity}`,
  });
  if (!packageEquivalent) {
    evidence.push(`Package equivalence not confirmed — quantity=${product.packageQuantity}`);
  } else {
    evidence.push(`Package equivalence confirmed — ${product.packageQuantity} ${product.standardUnit}`);
  }

  // ─── C04: PRICE_AND_MOQ_VALIDITY (CRITICAL) ────────────────────────────────
  const priceValid = product.priceInIdr !== null && product.priceInIdr > 0;
  const moqValid = product.moq !== null && product.moq >= 1;
  const priceAndMoqValid = priceValid && moqValid;
  gates.push({
    id: 'C04',
    name: 'Price and MOQ Validity',
    passed: priceAndMoqValid,
    critical: true,
    detail: `price=${product.priceInIdr}, moq=${product.moq}`,
  });
  if (!priceAndMoqValid) {
    evidence.push('Price or MOQ invalid — price or MOQ is null/negative');
  }

  // ─── C05: MARKETPLACE_COMPARABILITY_EXACT (CRITICAL) ───────────────────────
  // The marketplace listing must be directly comparable to supplier product
  const comparable = product.dataLineage !== null &&
    product.dataLineage.evidenceHierarchyLevel >= 3;
  gates.push({
    id: 'C05',
    name: 'Marketplace Comparability Exact',
    passed: comparable,
    critical: true,
    detail: `evidenceHierarchy=${product.dataLineage ? product.dataLineage.evidenceHierarchyLevel : 'null'}`,
  });
  if (!comparable) {
    evidence.push('Marketplace comparability not at sufficient evidence level');
  }

  // ─── C06: MARKET_CLEARING_PRICE_CALCULATED (CRITICAL) ───────────────────────
  // IDEA §16: Never use a single listing price as the market price.
  // The market clearing price must come from multi-listing aggregation with
  // outlier rejection and a confidence level.  INSUFFICIENT/LOW confidence
  // must fail-closed (REJECT).
  const mcp = input.marketClearingPrice ?? null;
  const hasClearingPrice = mcp?.marketClearingPrice !== null
    && mcp?.marketClearingPrice !== undefined
    && mcp.marketClearingPrice > 0;
  const clearingConfidenceOk = mcp?.priceConfidence === 'HIGH'
    || mcp?.priceConfidence === 'MEDIUM';
  // Fail-closed: clearing price must exist AND have at least MEDIUM confidence.
  const c06Passed = hasClearingPrice && clearingConfidenceOk;
  gates.push({
    id: 'C06',
    name: 'Market Clearing Price Calculated',
    passed: c06Passed,
    critical: true,
    detail: `clearingPrice=${mcp?.marketClearingPrice ?? 'null'}, confidence=${mcp?.priceConfidence ?? 'not computed'}, effectiveSample=${mcp?.effectiveSampleSize ?? 0}`,
  });
  if (!c06Passed) {
    if (!hasClearingPrice) {
      evidence.push('Market clearing price not computed or null — insufficient data (IDEA §16)');
    } else if (!clearingConfidenceOk) {
      evidence.push(`Market clearing price confidence=${mcp?.priceConfidence} — below MEDIUM threshold (IDEA §16)`);
    }
  } else {
    evidence.push(`Market clearing price: ${mcp?.marketClearingPrice} (confidence=${mcp?.priceConfidence}, sample=${mcp?.effectiveSampleSize})`);
  }

  // ─── C07: LANDED_COST_COMPLETE_NO_UNKNOWN (CRITICAL) ────────────────────────
  const hasLandedCost = economics.landedCost !== null;
  gates.push({
    id: 'C07',
    name: 'Landed Cost Complete (No Unknown)',
    passed: hasLandedCost,
    critical: true,
    detail: `landedCost=${economics.landedCost}`,
  });
  if (!hasLandedCost) {
    evidence.push('Landed cost is incomplete — UNKNOWN costs present');
  }

  // ─── C08: MARKETPLACE_FEES_FULLY_CONFIGURED (CRITICAL) ─────────────────────
  const feesConfigured = economics.marketplaceFee !== null &&
    economics.marketplaceFee > 0;
  gates.push({
    id: 'C08',
    name: 'Marketplace Fees Fully Configured',
    passed: feesConfigured,
    critical: true,
    detail: `marketplaceFee=${economics.marketplaceFee}`,
  });
  if (!feesConfigured) {
    evidence.push('Marketplace fees not fully configured');
  }

  // ─── C09: INDEPENDENT_PROFIT_CALCULATION_MATCH (CRITICAL) ──────────────────
  // IDEA.xml §7: Dual-engine double-entry validation
  const hasProfit = economics.profitCalculation !== null;
  const profitReconciled = economics.profitCalculation?.reconciled ?? false;
  const netProfit = economics.profitCalculation?.primaryResult.netProfitPerUnit;
  const profitPositive = hasProfit && netProfit !== undefined && netProfit.gt(0);
  gates.push({
    id: 'C09',
    name: 'Independent Profit Calculation Match',
    passed: hasProfit && profitReconciled && profitPositive,
    critical: true,
    detail: `hasProfit=${hasProfit}, reconciled=${profitReconciled}, profitPositive=${profitPositive}`,
  });
  if (hasProfit && !profitReconciled) {
    evidence.push('Double-entry validation FAILED — profit engines disagree');
  } else if (hasProfit && !profitPositive) {
    evidence.push('Profit reconciled but NEGATIVE/zero — opportunity not economically viable');
  } else if (hasProfit) {
    evidence.push('Profit validated via dual-engine (Engine A vs Engine B), profit is positive');
  }

  // ─── C10: DEMAND_EVIDENCE_SUFFICIENT (non-critical) ─────────────────────────
  // IDEA §18: Demand must come from the demand engine with signal
  // classification.  UNKNOWN demand (no OBSERVED signals) is a warning.
  const demand = input.demand ?? null;
  const demandOk = demand !== null
    && demand.demandScore !== null
    && demand.demandConfidence > 0.2;
  gates.push({
    id: 'C10',
    name: 'Demand Evidence Sufficient',
    passed: demandOk,
    critical: false,
    detail: `demandScore=${demand?.demandScore ?? 'null'}, class=${demand?.demandClass ?? 'not computed'}, confidence=${demand?.demandConfidence ?? 0}`,
  });
  if (!demandOk) {
    evidence.push(`WARNING: Demand insufficient — score=${demand?.demandScore ?? 'UNKNOWN'}, class=${demand?.demandClass ?? 'UNKNOWN'}`);
  } else {
    evidence.push(`Demand: score=${demand!.demandScore}, class=${demand!.demandClass} (confidence=${demand!.demandConfidence})`);
  }

  // ─── C11: COMPETITION_SATURATION_ACCEPTABLE (non-critical) ─────────────────
  // IDEA §19/§20: Competition must come from the competition engine.
  // EXTREME competition or HIGH price-war risk is a warning.
  const competition = input.competition ?? null;
  const competitionOk = competition !== null
    && competition.competitionLevel !== 'EXTREME'
    && competition.priceWarRisk !== 'HIGH';
  gates.push({
    id: 'C11',
    name: 'Competition Saturation Acceptable',
    passed: competitionOk,
    critical: false,
    detail: `competitionLevel=${competition?.competitionLevel ?? 'not computed'}, priceWarRisk=${competition?.priceWarRisk ?? 'UNKNOWN'}`,
  });
  if (!competitionOk) {
    evidence.push(`WARNING: Competition saturation high — level=${competition?.competitionLevel}, priceWarRisk=${competition?.priceWarRisk}`);
  } else {
    evidence.push(`Competition: level=${competition!.competitionLevel}, priceWarRisk=${competition!.priceWarRisk}`);
  }

  // ─── C12: RISK_THRESHOLDS_WITHIN_BOUNDS (CRITICAL) ─────────────────────────
  const riskWithinBounds = risk.overallRisk !== 'CRITICAL';
  gates.push({
    id: 'C12',
    name: 'Risk Thresholds Within Bounds',
    passed: riskWithinBounds,
    critical: true,
    detail: `overallRisk=${risk.overallRisk}, score=${risk.confidenceScore}`,
  });
  if (!riskWithinBounds) {
    evidence.push('BLOCKED: Overall risk is CRITICAL');
  } else {
    evidence.push(`Risk level ${risk.overallRisk} is within bounds`);
  }

  // ─── C13: DATA_FRESHNESS_WITHIN_TTL (CRITICAL) ─────────────────────────────
  // IDEA.xml §8: TTL enforcement — data must be within freshness window.
  // Phase 19.8: Enforce an explicit maximum acceptable age for marketplace
  // observations. If the observation timestamp is older than
  // MAX_MARKETPLACE_OBSERVATION_AGE_HOURS, the data is STALE and must NOT
  // generate a production opportunity.
  const freshnessTimestamp = product.retrievedAt || product.observedAt;
  let freshnessOk: boolean;
  let freshnessDetail: string;
  if (!freshnessTimestamp) {
    freshnessOk = false;
    freshnessDetail = 'observedAt=null (no timestamp)';
  } else {
    const freshnessStatus = computeFreshnessStatus(
      freshnessTimestamp,
      MAX_MARKETPLACE_OBSERVATION_AGE_HOURS,
    );
    freshnessOk = freshnessStatus === 'FRESH';
    freshnessDetail = `observedAt=${freshnessTimestamp}, freshness=${freshnessStatus}, maxAgeHours=${MAX_MARKETPLACE_OBSERVATION_AGE_HOURS}`;
  }
  gates.push({
    id: 'C13',
    name: 'Data Freshness Within TTL',
    passed: freshnessOk,
    critical: true,
    detail: freshnessDetail,
  });
  if (!freshnessOk) {
    evidence.push(`STALE_DATA: observation is null or older than ${MAX_MARKETPLACE_OBSERVATION_AGE_HOURS}h — production opportunity blocked (Phase 19.8)`);
  } else {
    evidence.push('Data freshness: observation within TTL');
  }

  // ─── C13b: PROVENANCE_PRODUCTION_ELIGIBLE (CRITICAL) ────────────────────────
  // Phase 19.3: Only REAL_OFFICIAL_API, REAL_PUBLIC_WEB, and REAL_PUBLIC_ENDPOINT
  // may participate in production analysis. TEST_FIXTURE, MOCK, and SIMULATION
  // are prohibited from creating production opportunities.
  const provenanceCategory = product.dataProvenance;
  let provenanceOk: boolean;
  let provenanceDetail: string;
  if (provenanceCategory === undefined) {
    // Backwards compatibility: pre-Phase-19 fixtures don't set dataProvenance.
    // They are treated as non-production-eligible to avoid accidentally promoting
    // fixture data to production. This is a conservative fail-closed default.
    provenanceOk = false;
    provenanceDetail = 'dataProvenance=undefined (not set — treated as non-production)';
  } else {
    provenanceOk = isProductionEligibleProvenance(provenanceCategory);
    provenanceDetail = `dataProvenance=${provenanceCategory}, productionEligible=${provenanceOk}`;
  }
  gates.push({
    id: 'C13b',
    name: 'Provenance Production Eligible',
    passed: provenanceOk,
    critical: true,
    detail: provenanceDetail,
  });
  if (!provenanceOk) {
    evidence.push(`Provenance not production-eligible — ${provenanceDetail}`);
  } else {
    evidence.push(`Provenance production-eligible: ${provenanceCategory}`);
  }


  // ─── C14: SENSITIVITY_ROBUSTNESS_PASS (CRITICAL) ────────────────────────────
  // IDEA.xml §31/§32: Sensitivity matrix and stress testing.
  // Must inspect the ACTUAL robustness rating from the sensitivity matrix,
  // not merely whether profit reconciled.
  const sensitivity = economics.profitCalculation?.sensitivity ?? null;
  const robustnessRating = sensitivity?.robustnessRating ?? null;
  // Accept MODERATE or better; FRAGILE/VERY_FRAGILE fail this gate.
  const robustnessOk = robustnessRating === 'MODERATE' || robustnessRating === 'ROBUST' || robustnessRating === 'VERY_ROBUST';
  gates.push({
    id: 'C14',
    name: 'Sensitivity Robustness Pass',
    passed: robustnessOk,
    critical: true,
    detail: `robustnessRating=${robustnessRating ?? 'null (not computed)'}`,
  });
  if (!robustnessOk) {
    evidence.push(`Sensitivity/robustness FAILED — robustness=${robustnessRating ?? 'not computed'} (requires MODERATE or better)`);
  } else {
    evidence.push(`Stress testing performed — robustness=${robustnessRating}`);
  }

  // ─── C15: CONFIDENCE_SCORE_ABOVE_FLOOR (CRITICAL) ───────────────────────────
  const confidenceOk = product.confidence >= CONFIDENCE_FLOOR;
  gates.push({
    id: 'C15',
    name: 'Confidence Score Above Floor',
    passed: confidenceOk,
    critical: true,
    detail: `confidence=${product.confidence}, floor=${CONFIDENCE_FLOOR}`,
  });
  if (!confidenceOk) {
    evidence.push(`Confidence ${product.confidence} below floor ${CONFIDENCE_FLOOR}`);
  }

  // ─── Determine Decision ────────────────────────────────────────────────────
  const criticalGates = gates.filter((g) => g.critical);
  const criticalPassed = criticalGates.every((g) => g.passed);

  let decision: OpportunityDecision;
  let qualityTier: 'S-TIER' | 'A-TIER' | 'B-TIER' | 'C-TIER' | 'REJECTED';

  if (!criticalPassed) {
    decision = 'REJECT';
    qualityTier = 'REJECTED';
    evidence.push('REJECTED: One or more critical gates failed');
  } else {
    // All critical gates passed — check warning gates
    const warningGates = gates.filter((g) => !g.critical);
    const warnings = warningGates.filter((g) => !g.passed);

    if (warnings.length > 0) {
      decision = 'REVIEW';
      evidence.push(`REVIEW: ${warnings.length} warning gate(s) need manual review`);
    } else {
      decision = 'RECOMMEND';
      evidence.push('RECOMMEND: All gates passed');
    }

    // Determine quality tier based on ROI and margin
    const roi = economics.profitCalculation?.primaryResult.roiPercent;
    const margin = economics.profitCalculation?.primaryResult.netMarginPercent;
    if (roi && margin) {
      const roiNum = roi.toNumber();
      const marginNum = margin.toNumber();
      if (roiNum >= 50 && marginNum >= 15) {
        qualityTier = 'S-TIER';
      } else if (roiNum >= 30 && marginNum >= 10) {
        qualityTier = 'A-TIER';
      } else if (roiNum >= 15 && marginNum >= 5) {
        qualityTier = 'B-TIER';
      } else {
        qualityTier = 'C-TIER';
      }
    } else {
      qualityTier = 'C-TIER';
    }
  }

  // Compute total score (0-100)
  const totalScore = computeTotalScore(gates, economics, risk, product);

  reqLogger.info('Opportunity decision', {
    decision,
    qualityTier,
    totalScore,
    criticalGatesPassed: criticalPassed,
    totalGates: gates.length,
  });

  return {
    decision,
    reason: evidence.join('; '),
    evidence,
    gates,
    qualityTier,
    totalScore,
  };
}

/**
 * Compute a composite opportunity score (0-100).
 *
 * Weighted factors (per IDEA.xml §9 ScoringWeights):
 * - Profitability (profit margin) — 20%
 * - Demand Strength — 15%
 * - Supplier Quality/Reliability — 10%
 * - Competition Landscape — 10%
 * - Price Stability — 8%
 * - Economic Robustness — 8%
 * - Capital Efficiency — 7%
 * - Downside Risk Score — 7%
 * - Data Confidence — 7%
 * - Opportunity Longevity/HalfLife — 5%
 * - Demand Trend Velocity — 3%
 */
function computeTotalScore(
  gates: GateResult[],
  economics: EconomicResult,
  risk: RiskAssessment,
  product: CanonicalProduct,
): number {
  let score = 0;

  // Profitability (20%)
  const margin = economics.profitCalculation?.primaryResult.netMarginPercent;
  if (margin) {
    const marginPct = Math.max(0, Math.min(30, margin.toNumber()));
    score += (marginPct / 30) * 20;
  }

  // Data confidence (15% combined with gate pass rate)
  score += product.confidence * 15;

  // Risk level inverted (15%)
  const riskMap: Record<string, number> = { LOW: 15, MEDIUM: 10, HIGH: 5, CRITICAL: 0 };
  score += riskMap[risk.overallRisk] || 0;

  // ROI (15%)
  const roi = economics.profitCalculation?.primaryResult.roiPercent;
  if (roi) {
    const roiPct = Math.max(0, Math.min(100, roi.toNumber()));
    score += (roiPct / 100) * 15;
  }

  // Supplier quality (10%)
  const supplierKey = risk.factors.supplierUnverified ? 'UNVERIFIED' : 'PARTIALLY_VERIFIED';
  const supplierScoreMap: Record<string, number> = { VERIFIED: 10, PARTIALLY_VERIFIED: 7, UNVERIFIED: 3, UNKNOWN: 1 };
  score += supplierScoreMap[supplierKey] || 0;

  // Gate pass rate (15%)
  const passedCount = gates.filter((g) => g.passed).length;
  score += (passedCount / gates.length) * 15;

  // Economic robustness (10%)
  if (economics.profitCalculation && economics.profitCalculation.reconciled) {
    score += 10;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}
