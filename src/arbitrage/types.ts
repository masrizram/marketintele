/**
 * Shared types for all arbitrage engine adapters.
 * Centralizes the types that every adapter and core module depends on.
 */

export type ULID = string;
export type Timestamp = string; // ISO-8601

export type CrawlEventStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'SOURCE_UNAVAILABLE'
  | 'PARSE_ERROR'
  | 'RETRYING';

export interface SourceMetadata {
  id: ULID;
  name: string;
  adapterName: string;
  baseUrl: string | null;
  isActive: boolean;
  trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  createdAt: Timestamp;
}

export interface CapabilityMatrix {
  supportsDiscover: boolean;
  supportsSearch: boolean;
  supportsFetch: boolean;
  supportsParse: boolean;
  supportsNormalize: boolean;
  supportsHealthCheck: boolean;
  extras: Record<string, string | boolean | number>;
}

export interface RawPayload {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  observedAt: Timestamp;
  bytesLength: number;
}

export interface RawDocument {
  id: ULID;
  crawlId: ULID;
  sourceId: ULID;
  url: string;
  observedAt: Timestamp;
  httpStatus: number;
  latencyMs: number;
  contentType: string;
  contentHash: string;
  parserVersion: string;
  rawPayload: string;
}

export interface ParsedEntities {
  rawDocumentId: ULID;
  entities: ParsedEntity[];
  extractionMethod: string;
  extractionConfidence: number;
}

export interface ParsedEntity {
  rawDocumentId: ULID;
  sourceId: ULID;
  extractedAt: Timestamp;
  title: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  moq: number | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  supplierName: string | null;
  supplierType: string | null;
  marketplace: string | null;
  sellerId: string | null;
  sellerName: string | null;
  rating: number | null;
  reviewCount: number | null;
  soldCount: number | null;
  rawEvidence: Record<string, unknown>;
  extractionConfidence?: number;
}

export interface CanonicalProduct {
  id: ULID;
  canonicalTitle: string;
  brand: string | null;
  model: string | null;
  categoryId: ULID | null;
  standardUnit: string;
  standardWeightGrams: number | null;
  standardDimensionsCm: string | null;
  sku: string | null;
  barcode: string | null;
  priceInIdr: number | null;
  currencyConverted: boolean;
  moq: number;
  packageQuantity: number;
  packageUnit: string;
  sourceId: ULID;
  supplierProductId: ULID | null;
  marketplaceListingId: ULID | null;
  sellerId: string | null;          // marketplace seller identity (for supplier resolution)
  sellerName: string | null;        // marketplace seller display name
  marketplaceListingUrl: string | null; // URL of the product listing on the marketplace
  observedAt: Timestamp;
  confidence: number;
  dataLineage: DataLineage;
}

export interface DataLineage {
  sourceId: ULID;
  rawDocumentId: ULID;
  rawEvidenceHash: string;
  extractionMethod: string;
  observedAt: Timestamp;
  confidence: number;
  evidenceHierarchyLevel: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface SourceHealthStatus {
  isHealthy: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: Timestamp;
  errorCount24h: number;
}

export interface CrawlPrioritizationInput {
  opportunityDensity: number;
  dataQuality: number;
  freshnessValue: number;
  historicalSuccess: number;
  sourceReliability: number;
}

export function computeSourceEconomicValue(input: CrawlPrioritizationInput): number {
  return (
    input.opportunityDensity *
    input.dataQuality *
    input.freshnessValue *
    input.historicalSuccess *
    input.sourceReliability
  );
}

export interface SourceAdapter {
  readonly adapterName: string;
  readonly sourceName: string;
  readonly baseUrl: string | null;
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  readonly isActive: boolean;
  search(query: string, filters?: Record<string, unknown>): Promise<unknown>;
  fetch(target: string): Promise<RawPayload>;
  parse(rawDocument: RawDocument): Promise<ParsedEntities>;
  normalize(parsedData: ParsedEntity): Promise<CanonicalProduct>;
  healthCheck?(): Promise<SourceHealthStatus>;
  getMetadata(): SourceMetadata;
  getCapabilities(): CapabilityMatrix;
}

export interface RawResultSet extends Array<unknown> {}

export type Marketplace = 'shopee' | 'tokopedia' | 'lazada' | 'blibli' | 'tiktok_shop';

/** Zod schema for marketplace identifiers — used in fee/config validation. */
import { z } from 'zod';

export const MarketplaceIdSchema = z.enum([
  'shopee',
  'tokopedia',
  'lazada',
  'blibli',
  'tiktok_shop',
]);

export interface MarketplaceSource extends SourceAdapter {
  readonly marketplace: Marketplace;
}
