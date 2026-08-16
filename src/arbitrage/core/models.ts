/**
 * Data models for the arbitrage engine.
 *
 * Core entities as specified in IDEA.xml §10 (DatabaseSchemaArchitecture).
 * These are the TypeScript representations, paired with the database schema.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Universally unique identifier type
// ─────────────────────────────────────────────────────────────────────────────

/** ULID (Universally Unique Lexicographically Sortable Identifier) */
export type ULID = string;

/** Generate a time-sortable ULID using the ulid package. */
import { ulid } from 'ulid';
export function generateULID(): ULID {
  return ulid();
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Source
// ─────────────────────────────────────────────────────────────────────────────

export interface Source {
  id: ULID;
  name: string;
  adapterName: string;
  baseUrl: string;
  isActive: boolean;
  trustTier: 1 | 2 | 3 | 4 | 5 | 6;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceHealth {
  id: ULID;
  sourceId: ULID;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unavailable';
  errorRate: number;       // 0-1
  latencyP95Ms: number;
  updatedAt: Date;
}

export interface CrawlJob {
  id: ULID;
  sourceId: ULID;
  scheduledAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'rate_limited';
  retryCount: number;
  priority: number;
}

export interface CrawlEvent {
  id: ULID;
  jobId: ULID;
  url: string;
  httpStatus: number;
  latencyMs: number;
  contentHash: string;     // SHA-256 hex
  observedAt: Date;
}

export interface RawDocument {
  id: ULID;
  crawlEventId: ULID;
  payloadBlob: string;     // JSON-encoded raw payload
  parserVersion: string;
  checksum: string;        // SHA-256 hex
  createdAt: Date;
}

export interface RawProduct {
  id: ULID;
  rawDocumentId: ULID;
  extractedJson: string;   // JSON-encoded extracted product data
  extractionConfidence: number;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Supplier
// ─────────────────────────────────────────────────────────────────────────────

export type SupplierType =
  | 'FACTORY'
  | 'MANUFACTURER'
  | 'DISTRIBUTOR'
  | 'IMPORTER'
  | 'WHOLESALER'
  | 'TRADING_COMPANY'
  | 'RESELLER'
  | 'UNKNOWN';

export type SupplierVerificationStatus =
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'UNVERIFIED'
  | 'SUSPICIOUS'
  | 'UNKNOWN';

export interface Supplier {
  id: ULID;
  name: string;
  legalName?: string;
  type: SupplierType;
  verificationStatus: SupplierVerificationStatus;
  confidenceScore: number;   // 0-1
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierContact {
  id: ULID;
  supplierId: ULID;
  channelType: 'phone' | 'email' | 'whatsapp' | 'telegram' | 'website';
  value: string;
  isVerified: boolean;
}

export interface SupplierProduct {
  id: ULID;
  supplierId: ULID;
  rawTitle: string;
  normalizedTitle: string;
  sku?: string;
  barcode?: string;
  moq: number;
  packageQuantity?: number;
  packageUnit?: string;
  attributesJson?: string;
  createdAt: Date;
}

export interface SupplierPrice {
  id: ULID;
  supplierProductId: ULID;
  tierMin: number;
  tierMax?: number;
  price: number;           // in IDR
  currency: string;        // 'IDR'
  observedAt: Date;
}

export interface SupplierPriceTier {
  tier: number;
  minQuantity: number;
  maxQuantity?: number;
  pricePerUnit: number;
  pricePerPackage?: number;
  currency: string;
  observedAt: Date;
  source?: string;
  confidence?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Product
// ─────────────────────────────────────────────────────────────────────────────

export interface Product {
  id: ULID;
  canonicalTitle: string;
  brand?: string;
  model?: string;
  categoryId?: ULID;
  standardUnit: string;       // 'pcs', 'ml', 'gram', 'meter', etc.
  standardWeight?: number;     // in grams
  standardDimensions?: string; // "10x5x3 cm"
  createdAt: Date;
}

export interface ProductVariant {
  id: ULID;
  productId: ULID;
  variantName: string;
  sku?: string;
  barcode?: string;
  packageQuantity: number;
  packageUnit: string;
}

export type ProductMatchType =
  | 'EXACT_SAME_PRODUCT'
  | 'SAME_PRODUCT_DIFFERENT_PACKAGE'
  | 'SAME_PRODUCT_DIFFERENT_VARIANT'
  | 'SAME_PRODUCT_DIFFERENT_BRAND'
  | 'SUBSTITUTE'
  | 'SIMILAR'
  | 'UNRELATED'
  | 'UNKNOWN';

export interface ProductMatch {
  id: ULID;
  productId: ULID;
  supplierProductId: ULID;
  matchType: ProductMatchType;
  matchScore: number;        // 0-1
  isVerified: boolean;
  matchSignalsJson?: string;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Marketplace
// ─────────────────────────────────────────────────────────────────────────────

export type MarketplaceName =
  | 'Shopee'
  | 'Tokopedia'
  | 'TikTokShop'
  | 'Lazada'
  | 'Blibli';

export interface Marketplace {
  id: ULID;
  name: MarketplaceName;
  region: string;             // 'ID', 'MY', etc.
  apiAdapter?: string;
  isActive: boolean;
}

export interface MarketplaceListing {
  id: ULID;
  marketplaceId: ULID;
  productId?: ULID;
  sellerId: string;
  sellerName?: string;
  title: string;
  url: string;
  rating?: number;
  soldCount?: number;
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
  imageUrl?: string;
  categoryPath?: string;
  listingAgeDays?: number;
  observedAt: Date;
}

export interface MarketplacePrice {
  id: ULID;
  listingId: ULID;
  price: number;             // in IDR
  originalPrice?: number;
  discountPercent?: number;
  discountLabel?: string;
  flashSale?: boolean;
  vipDiscount?: number;
  observedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Demand & Competition
// ─────────────────────────────────────────────────────────────────────────────

export type DemandDataTier = 'OBSERVED' | 'MODEL_ESTIMATE' | 'HEURISTIC' | 'INSUFFICIENT_DATA';

export interface DemandSignal {
  id: ULID;
  productId: ULID;
  estimatedMonthlyDemand?: number;
  velocity?: number;          // sales/day estimate
  confidence: number;
  dataTier: DemandDataTier;
  sourceNotes?: string;
  observedAt: Date;
}

export interface CompetitionSnapshot {
  id: ULID;
  productId: ULID;
  sellerCount: number;
  hhiIndex?: number;          // Herfindahl-Hirschman Index
  topSellerShare?: number;
  priceDispersion?: number;   // coefficient of variation
  lowestPrice?: number;
  highestPrice?: number;
  medianPrice?: number;
  priceWarRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  competitionLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  marketSaturationScore?: number;
  observedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Cost & Profit Models
// ─────────────────────────────────────────────────────────────────────────────

export interface LandedCostBreakdown {
  supplierBaseCost: number;
  inboundLogistics: number;
  importDutiesTariffs: number;
  valueAddedTax: number;
  customsClearance: number;
  supplierPaymentProcessingFee: number;
  inboundPackagingMaterials: number;
  qualityInspectionCost: number;
  wastageAndDefectReserve: number;
  handlingWarehousingInbound: number;
  totalLandedCost: number;
}

export interface MarketplaceFeeBreakdown {
  platformCommissionFee: number;
  transactionPaymentFee: number;
  mandatoryAffiliateFee: number;
  campaignParticipationFee: number;
  sellerVoucherCost: number;
  freeShippingSubsidyCost: number;
  allocatedAdSpendPerUnit: number;
  outboundPackaging: number;
  returnRefundLossProvision: number;
  operationalHandlingCost: number;
  totalMarketplaceCost: number;
}

export interface CostModel {
  id: ULID;
  productId: ULID;
  landedCost: number;
  feesBreakdownJson: string;    // JSON-encoded MarketplaceFeeBreakdown
  version: string;
  createdAt: Date;
}

export interface ProfitModel {
  id: ULID;
  costModelId: ULID;
  netProfitPerUnit: number;
  netMarginPercent: number;
  roiPercent: number;
  breakEvenPrice: number;
  breakEvenRoas?: number;
  calculationHash: string;
  // Scenario results
  bearScenario: ScenarioResult;
  baseScenario: ScenarioResult;
  bullScenario: ScenarioResult;
  // Sensitivity
  sensitivityMatrixJson?: string;
  robustnessRating?: 'VERY_FRAGILE' | 'FRAGILE' | 'MODERATE' | 'ROBUST' | 'VERY_ROBUST';
  createdAt: Date;
}

export interface ScenarioResult {
  sellingPrice: number;
  netProfitPerUnit: number;
  netMarginPercent: number;
  roiPercent: number;
  scenarioType: 'BEAR' | 'BASE' | 'BULL';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Opportunities
// ─────────────────────────────────────────────────────────────────────────────

export type OpportunityQualityTier = 'S-TIER' | 'A-TIER' | 'B-TIER' | 'C-TIER' | 'REJECTED';
export type OpportunityState = 'ACTIVE' | 'WEAKENING' | 'DECAYING' | 'COLLAPSED' | 'EXPIRED' | 'TESTED' | 'SCALED' | 'REJECTED';

export interface Opportunity {
  id: ULID;
  productId: ULID;
  supplierId: ULID;
  qualityTier: OpportunityQualityTier;
  state: OpportunityState;
  halfLifeDays?: number;
  expectedValue?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpportunityScore {
  id: ULID;
  opportunityId: ULID;
  totalScore: number;          // 0-100
  breakdownJson: string;       // JSON-encoded factor breakdown
  scoreVersion: string;
  createdAt: Date;
}

export interface OpportunityScoreBreakdown {
  profitability: number;      // 0-100, weight 20%
  demandStrength: number;     // 0-100, weight 15%
  supplierQuality: number;    // 0-100, weight 10%
  competitionLandscape: number; // 0-100, weight 10%
  priceStability: number;     // 0-100, weight 8%
  economicRobustness: number; // 0-100, weight 8%
  capitalEfficiency: number;  // 0-100, weight 7%
  downsideRisk: number;       // 0-100, weight 7%
  dataConfidence: number;     // 0-100, weight 7%
  opportunityLongevity: number; // 0-100, weight 5%
  demandTrendVelocity: number; // 0-100, weight 3%
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Test Orders & Actuals
// ─────────────────────────────────────────────────────────────────────────────

export type TestOrderStatus = 'PLANNED' | 'ORDERED' | 'IN_TRANSIT' | 'RECEIVED' | 'SELLING' | 'COMPLETED' | 'CANCELLED';

export interface TestOrder {
  id: ULID;
  opportunityId: ULID;
  status: TestOrderStatus;
  testQuantity: number;
  testCapital: number;
  outcomeProfit?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalesActual {
  id: ULID;
  testOrderId: ULID;
  realizedRevenue: number;
  realizedCosts: number;
  realizedProfit: number;
  returnsCount: number;
  sellThroughPercent?: number;
  observationPeriodDays?: number;
  createdAt: Date;
}

export interface ProfitAttribution {
  id: ULID;
  salesActualId: ULID;
  predictedProfit: number;
  delta: number;              // realized - predicted
  errorReason?: string;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Entity: Audit & Calibration
// ─────────────────────────────────────────────────────────────────────────────

export type AuditActorType = 'SYSTEM' | 'HUMAN' | 'ADMIN' | 'API' | 'CRON' | 'BOT';

export interface AuditLog {
  id: ULID;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  entityName: string;
  entityId?: ULID;
  beforeJson?: string;
  afterJson?: string;
  timestamp: Date;
}

export interface ModelCalibration {
  id: ULID;
  modelName: string;
  version: string;
  mape: number;               // Mean Absolute Percentage Error
  bias: number;               // systematic over/under-estimation
  adjustedWeightsJson?: string;
  backtestPassed: boolean;
  createdAt: Date;
}
