/**
 * Pipeline types — the end-to-end arbitration flow.
 *
 * Telegram command
 *   → Discovery
 *   → Marketplace adapter (fetch + parse + normalize)
 *   → Product matching
 *   → Supplier/source lookup
 *   → Landed cost
 *   → Profit calculation
 *   → Risk assessment
 *   → Opportunity decision
 *   → Telegram result
 */
import { CanonicalProduct } from '../types';
import { FullProfitCalculation } from '../economic/profit-engine';
import { FeeConfigModel } from '../economic/fee-config';
import type { MarketClearingPriceResult } from '../intelligence/market-clearing';
import type { DemandResult } from '../intelligence/demand';
import type { CompetitionResult } from '../intelligence/competition';
import type { DecayResult } from '../intelligence/opportunity-decay';
import type { EVResult } from '../intelligence/expected-value';
import type { ComprehensiveRiskResult } from '../intelligence/risk-assessment';

// ─── Discovery Result ────────────────────────────────────────────────────────

export type DiscoveryStatus =
  | 'SUCCESS'
  | 'EMPTY_RESULT'
  | 'TIMEOUT'
  | 'SOURCE_ERROR'
  | 'VALIDATION_ERROR'
  | 'SYSTEM_ERROR';

export interface DiscoveryResult {
  requestId: string;
  status: DiscoveryStatus;
  marketplace: string;
  query: string;
  products: CanonicalProduct[];
  error: string | null;
  metadata: {
    adapterName: string;
    sourceUrl: string | null;
    elapsedMs: number;
    observedAt: string;
  };
}

// ─── Supplier Resolution ─────────────────────────────────────────────────────

export type SupplierConfidenceTier = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';

export interface SupplierSource {
  id: string;
  name: string;
  type: 'FACTORY' | 'MANUFACTURER' | 'DISTRIBUTOR' | 'IMPORTER' | 'WHOLESALE' | 'RESELLER' | 'UNKNOWN';
  sourceUrl: string | null;
  sourcePriceIdr: number | null;   // null = unknown, NOT zero
  moq: number | null;              // null = unknown
  shippingCostIdr: number | null;  // null = unknown
  contactInfo: string | null;
  evidence: string | null;
  confidence: SupplierConfidenceTier;
  confidenceScore: number;         // 0-1
  observedAt: string;
  /** Data provenance from supplier adapter (REAL / TEST_FIXTURE / NONE). */
  dataProvenance?: 'REAL' | 'TEST_FIXTURE' | 'NONE';
  /** Supplier product name from the source. */
  supplierProductName?: string | null;
  /** Supplier product URL for direct reference. */
  supplierProductUrl?: string | null;
}

// ─── Economic Result ─────────────────────────────────────────────────────────

export interface EconomicResult {
  supplierBaseCost: number | null;         // null = unknown
  landedCost: number | null;               // null = unknown
  landedCostBreakdown: Record<string, number | null> | null;
  marketplaceFee: number | null;           // null = unknown
  marketplaceFeeBreakdown: Record<string, number | null> | null;
  feeConfigUsed: FeeConfigModel | null;    // null = not available
  sellingPriceIdr: number;                 // from marketplace listing
  profitCalculation: FullProfitCalculation | null;  // null if calculation failed
  profitError: string | null;
}

// ─── Risk Assessment ─────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskAssessment {
  overallRisk: RiskLevel;
  supplierRisk: RiskLevel;
  productRisk: RiskLevel;
  marketRisk: RiskLevel;
  confidenceScore: number;  // 0-1
  factors: {
    supplierUnverified: boolean;
    dataFreshnessHours: number | null;
    priceVolatility: number | null;
    priceWarRisk: boolean;
    counterfeitRisk: boolean;
    operationalRisk: boolean;
    singleSupplier: boolean;
    lowDemandConfidence: boolean;
  };
  evidence: string[];
}

// ─── Opportunity Decision ────────────────────────────────────────────────────

export type OpportunityDecision = 'RECOMMEND' | 'REVIEW' | 'REJECT';

export interface OpportunityResult {
  decision: OpportunityDecision;
  reason: string;
  evidence: string[];
  gates: Array<{
    id: string;
    name: string;
    passed: boolean;
    critical: boolean;
    detail: string;
  }>;
  qualityTier: 'S-TIER' | 'A-TIER' | 'B-TIER' | 'C-TIER' | 'REJECTED';
  totalScore: number;  // 0-100
}

// ─── Full Pipeline Result ────────────────────────────────────────────────────

export type PipelineStage = 'full' | 'discovery' | 'matching' | 'supplier' | 'economics' | 'risk' | 'decision';

export interface PipelineContext {
  requestId: string;
  correlationId: string;
  userId: number;
  query: string;
  requestedAt: string;
}

export interface PipelineResult {
  context: PipelineContext;
  discovery: DiscoveryResult | null;
  canonicalProduct: CanonicalProduct | null;
  supplier: SupplierSource | null;
  economics: EconomicResult | null;
  risk: RiskAssessment | null;
  /** Market clearing price from multi-listing aggregation (IDEA §16). */
  marketClearingPrice: MarketClearingPriceResult | null;
  /** Demand intelligence (IDEA §18). */
  demand: DemandResult | null;
  /** Competition intelligence (IDEA §19). */
  competition: CompetitionResult | null;
  /** Opportunity decay/half-life (IDEA §31). */
  decay: DecayResult | null;
  /** Expected value (IDEA §26). */
  expectedValue: EVResult | null;
  /** Comprehensive 11-dimension risk (IDEA §27). */
  comprehensiveRisk: ComprehensiveRiskResult | null;
  opportunity: OpportunityResult | null;
  formattedResult: string;       // Telegram message
  error: string | null;          // if pipeline failed entirely
  elapsedMs: number;
}
