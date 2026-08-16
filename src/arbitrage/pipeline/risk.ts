/**
 * Risk Engine
 *
 * Assesses multi-dimensional risk for arbitrage opportunities:
 * - Supplier risk (verification status, confidence)
 * - Product risk (data freshness, match confidence)
 * - Market risk (price volatility, competition, price wars)
 *
 * Risk MUST influence the opportunity decision — it never gets computed
 * and then ignored.
 *
 * IDEA.xml §15 (Risk Management).
 */
import { CanonicalProduct } from '../types';
import { SupplierSource, RiskAssessment, RiskLevel, EconomicResult } from './types';
import { createRequestLogger } from './logger';

export interface RiskInput {
  product: CanonicalProduct;
  supplier: SupplierSource;
  economics: EconomicResult;
  marketplace: string;
  listingAgeHours: number | null;
  requestId: string;
}

/**
 * Compute risk assessment for a product+supplier pair.
 *
 * Each risk dimension is scored 0-1 (1 = worst risk).
 * The overall risk is the maximum of the critical dimensions.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const { product, supplier, economics, listingAgeHours, requestId } = input;
  const reqLogger = createRequestLogger(requestId);

  const evidence: string[] = [];
  const factors = {
    supplierUnverified: false,
    dataFreshnessHours: listingAgeHours,
    priceVolatility: null as number | null,
    priceWarRisk: false,
    counterfeitRisk: false,
    operationalRisk: false,
    singleSupplier: true,
    lowDemandConfidence: false,
  };

  let supplierRiskScore = 0;
  let productRiskScore = 0;
  let marketRiskScore = 0;

  // Supplier Risk
  if (supplier.confidence === 'UNKNOWN') {
    factors.supplierUnverified = true;
    supplierRiskScore += 0.5;
    evidence.push('Supplier is UNVERIFIED — no contact or identity verification');
  } else if (supplier.confidence === 'PARTIALLY_VERIFIED') {
    supplierRiskScore += 0.25;
    evidence.push('Supplier is PARTIALLY_VERIFIED — identity derived from marketplace seller only');
  } else {
    supplierRiskScore += 0.1;
    evidence.push('Supplier verification status is acceptable');
  }

  if (supplier.confidenceScore < 0.3) {
    factors.supplierUnverified = true;
    supplierRiskScore = Math.max(supplierRiskScore, 0.4);
  }

  if (supplier.sourcePriceIdr === null) {
    supplierRiskScore += 0.3;
    evidence.push('Supplier price is UNKNOWN — price risk is high');
  }

  if (supplier.shippingCostIdr === null) {
    supplierRiskScore += 0.2;
    evidence.push('Shipping cost is UNKNOWN — logistics risk is present');
  }

  // Product Risk
  if (product.confidence < 0.3) {
    productRiskScore += 0.4;
    evidence.push(`Product confidence is low (${product.confidence.toFixed(2)})`);
  }

  if (product.priceInIdr === null) {
    productRiskScore += 0.5;
    evidence.push('Product price is UNKNOWN — cannot assess profitability');
    factors.lowDemandConfidence = true;
  }

  // Data freshness
  if (listingAgeHours !== null) {
    if (listingAgeHours > 168) {
      productRiskScore += 0.2;
      evidence.push(`Listing data is stale (${listingAgeHours}h old)`);
    } else if (listingAgeHours > 24) {
      productRiskScore += 0.1;
      evidence.push(`Listing data is moderately fresh (${listingAgeHours}h old)`);
    }
  } else {
    evidence.push('Listing freshness UNKNOWN — treated as moderate risk');
    productRiskScore += 0.1;
  }

  // Market Risk
  if (economics.profitCalculation) {
    const margin = economics.profitCalculation.primaryResult.netMarginPercent.toNumber();
    if (margin < 0.05) {
      marketRiskScore += 0.3;
      evidence.push(`Very thin margin (${margin.toFixed(1)}%) — high price volatility risk`);
    } else if (margin < 0.15) {
      marketRiskScore += 0.15;
      evidence.push(`Low margin (${margin.toFixed(1)}%) — moderate price volatility risk`);
    }
  }

  if (factors.singleSupplier) {
    marketRiskScore += 0.1;
    evidence.push('Product depends on single supplier — no alternative identified');
  }

  if (supplier.confidence !== 'VERIFIED') {
    factors.counterfeitRisk = true;
    productRiskScore += 0.15;
    evidence.push('Counterfeit risk: seller verification status is not VERIFIED');
  }

  factors.operationalRisk = true;
  productRiskScore += 0.1;
  evidence.push('Operational risk: cross-border shipping, customs, returns');

  function scoreToLevel(score: number): RiskLevel {
    if (score >= 0.6) return 'CRITICAL';
    if (score >= 0.4) return 'HIGH';
    if (score >= 0.2) return 'MEDIUM';
    return 'LOW';
  }

  const overallScore = Math.max(supplierRiskScore, productRiskScore, marketRiskScore);
  const overallRisk = scoreToLevel(overallScore);

  reqLogger.info('Risk assessment completed', {
    overallRisk,
    supplierRisk: scoreToLevel(supplierRiskScore),
    productRisk: scoreToLevel(productRiskScore),
    marketRisk: scoreToLevel(marketRiskScore),
    overallScore,
    confidenceScore: 1 - overallScore,
  });

  return {
    overallRisk,
    supplierRisk: scoreToLevel(supplierRiskScore),
    productRisk: scoreToLevel(productRiskScore),
    marketRisk: scoreToLevel(marketRiskScore),
    confidenceScore: Math.max(0, 1 - overallScore),
    factors,
    evidence,
  };
}
