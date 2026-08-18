/**
 * Blibli Indonesia Marketplace Adapter (v2 — real implementation)
 *
 * Blibli: https://www.blibli.com/
 *
 * Uses Blibli's public search API and product page endpoints.
 * Never returns fabricated data.
 */
import { BaseSourceAdapter } from './base-adapter';
import {
  RawResultSet,
  RawPayload,
  RawDocument,
  ParsedEntities,
  ParsedEntity,
  CanonicalProduct,
  SourceHealthStatus,
  SourceMetadata,
  CapabilityMatrix,
} from '../types';
import { sha256 } from '../lib/hash';
import { ulid } from 'ulid';

export class BlibliAdapter extends BaseSourceAdapter {
  readonly adapterName = 'BlibliAdapter';
  readonly sourceName = 'Blibli Indonesia';
  readonly baseUrl = 'https://www.blibli.com';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'blibli' as const;
  /** Phase 19.3: Blibli uses a public CMS API endpoint (no auth) — REAL_PUBLIC_ENDPOINT. */
  readonly dataProvenance = 'REAL_PUBLIC_ENDPOINT' as const;
  readonly acquisitionMethod = 'PUBLIC_ENDPOINT' as const;
  readonly reliabilityTier = 'C' as const;

  private readonly requestTimeoutMs = 15000;
  private readonly searchApiUrl = 'https://www.blibli.com/cms-api/product-search';

  constructor() {
    super();
  }

  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[Blibli] Searching for: "${query}"`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[Blibli] Empty query provided');
      return [];
    }

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      // Blibli's public search API returns JSON
      const url = `${this.searchApiUrl}?searchTerm=${encodedQuery}&page=1&itemPerPage=10`;

      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        timeout: this.requestTimeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://www.blibli.com/',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (response.status !== 200) {
        this.logger.error(`[Blibli] HTTP ${response.status} on search for "${query}"`);
        return [];
      }

      const data = response.data as any;
      if (!data || !data.data || !Array.isArray(data.data)) {
        this.logger.warn('[Blibli] No data array in API response');
        return [];
      }

      if (data.data.length === 0) {
        this.logger.info(`[Blibli] Empty result for "${query}"`);
        return [];
      }

      const results = data.data.map((item: any) => ({
        url: item.productPageUrl || item.url || item.detailUrl || '',
        title: item.name || item.title || item.productName || '',
        price: item.price ? this.extractPrice(item.price) : (item.discountedPrice ? this.extractPrice(item.discountedPrice) : null),
        currency: 'IDR',
        seller: item.merchant?.name || item.sellerName || item.storeName || null,
        sellerId: item.merchant?.code ? String(item.merchant.code) : null,
        rating: item.rating ? Number(item.rating) : null,
        reviewCount: item.reviewCount ? Number(item.reviewCount) : null,
        soldCount: item.soldCount ? Number(item.soldCount) : null,
        image: item.image || item.imageUrl || item.imgUrl || null,
        itemId: item.code || item.productId || item.id ? String(item.code || item.productId || item.id) : null,
        categoryId: item.categoryId ? String(item.categoryId) : null,
        rawMetadata: item,
      }));

      this.logger.info(`[Blibli] Found ${results.length} results for "${query}"`);
      return results as unknown as RawResultSet;
    } catch (err) {
      this.logger.error(`[Blibli] Search error for "${query}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Extract numeric price from Blibli's price format.
   * Blibli may return price as string with formatting or number.
   */
  private extractPrice(price: any): number | null {
    if (price === null || price === undefined) return null;
    if (typeof price === 'number') return Number.isFinite(price) ? price : null;
    if (typeof price === 'string') {
      const cleaned = price.replace(/[^0-9]/g, '');
      if (cleaned.length > 0) {
        const n = parseInt(cleaned, 10);
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  }

  async fetch(target: string): Promise<RawPayload> {
    if (!(await this.isSafeUrl(target))) {
      throw new Error(`SSRF blocked: ${target} is not a public URL`);
    }
    await this.throttle(new URL(target).hostname);

    try {
      const response = await this.fetchWithRetry(target, {
        method: 'GET',
        timeout: this.requestTimeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://www.blibli.com/',
        },
        responseType: 'text',
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status} fetching ${target}`);
      }

      return {
        url: target,
        statusCode: response.status,
        headers: response.headers,
        body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
        contentType: response.headers['content-type'] || 'text/html',
        observedAt: new Date().toISOString(),
        bytesLength: typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('timeout')) {
        throw new Error(`Timeout fetching ${target}`);
      }
      throw err;
    }
  }

  async parse(rawDocument: RawDocument): Promise<ParsedEntities> {
    const sourceId = rawDocument.sourceId || 'blibli';
    const extractedAt = new Date().toISOString();
    const html = rawDocument.rawPayload;

    // Try JSON-LD first
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/g;
    let structuredData: any = null;
    let match: RegExpExecArray | null;

    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1].trim());
        if (data?.['@type'] === 'Product') {
          structuredData = data;
          break;
        }
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item?.['@type'] === 'Product') {
              structuredData = item;
              break;
            }
          }
          if (structuredData) break;
        }
      } catch {
        // Continue
      }
    }

    // Fallback: window.__appData
    if (!structuredData) {
      const appDataRegex = /window\.__appData\s*=\s*(\{[^]+?\})\s*;?/;
      const appDataMatch = html.match(appDataRegex);
      if (appDataMatch) {
        try {
          structuredData = JSON.parse(appDataMatch[1]);
        } catch {
          // continue
        }
      }
    }

    if (!structuredData) {
      this.logger.warn(`[Blibli] No structured data found in ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'blibli-html-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    const itemInfo = structuredData;

    const entity: ParsedEntity = {
      rawDocumentId: rawDocument.id,
      sourceId,
      extractedAt,
      title: itemInfo.name || itemInfo.title || '',
      brand: itemInfo.brand || itemInfo.brandName || null,
      model: itemInfo.model || null,
      sku: itemInfo.sku || itemInfo.mpn || null,
      barcode: itemInfo.barcode || itemInfo.ean || null,
      category: itemInfo.category || itemInfo.categoryId ? String(itemInfo.categoryId || itemInfo.category) : null,
      price: this.extractPrice(itemInfo.offers?.price || itemInfo.price),
      currency: itemInfo.offers?.priceCurrency || 'IDR',
      moq: itemInfo.moq || 1,
      packageQuantity: 1,
      packageUnit: 'pcs',
      supplierName: itemInfo.seller?.name || itemInfo.merchant?.name || null,
      supplierType: 'RESELLER',
      marketplace: 'blibli',
      sellerId: itemInfo.seller?.id ? String(itemInfo.seller.id) : (itemInfo.merchant?.code ? String(itemInfo.merchant.code) : null),
      sellerName: itemInfo.seller?.name || itemInfo.merchant?.name || null,
      rating: itemInfo.aggregateRating?.ratingValue || itemInfo.rating || null,
      reviewCount: itemInfo.aggregateRating?.reviewCount || null,
      soldCount: null,
      rawEvidence: {
        url: rawDocument.url,
        description: itemInfo.description || null,
        offers: itemInfo.offers || null,
      },
      extractionConfidence: itemInfo.name ? 0.75 : 0,
    };

    return {
      rawDocumentId: rawDocument.id,
      entities: [entity],
      extractionMethod: 'blibli-html-parser-v1.0',
      extractionConfidence: entity.extractionConfidence ?? 0,
    };
  }

  async normalize(parsedData: ParsedEntity): Promise<CanonicalProduct> {
    const priceIdr =
      typeof parsedData.price === 'number' && Number.isFinite(parsedData.price)
        ? parsedData.price
        : null;
    const retrievedAt = new Date().toISOString();
    const rawEvidence = parsedData.rawEvidence || {};
    const listingUrl = (rawEvidence.url as string) || null;

    return {
      id: ulid(),
      canonicalTitle: parsedData.title,
      brand: parsedData.brand,
      model: parsedData.model,
      categoryId: null,
      standardUnit: 'pcs',
      standardWeightGrams: null,
      standardDimensionsCm: null,
      sku: parsedData.sku,
      barcode: parsedData.barcode,
      priceInIdr: priceIdr,
      currencyConverted: priceIdr !== null,
      moq: parsedData.moq ?? 1,
      packageQuantity: parsedData.packageQuantity ?? 1,
      packageUnit: parsedData.packageUnit || 'pcs',
      sourceId: parsedData.sourceId,
      supplierProductId: null,
      marketplaceListingId: null,
      sellerId: parsedData.sellerId || null,
      sellerName: parsedData.sellerName || null,
      marketplaceListingUrl: listingUrl,
      observedAt: parsedData.extractedAt,
      confidence: parsedData.extractionConfidence || 0,
      dataProvenance: this.dataProvenance,
      acquisitionMethod: this.acquisitionMethod,
      retrievedAt,
      rating: parsedData.rating ?? null,
      reviewCount: parsedData.reviewCount ?? null,
      soldCount: parsedData.soldCount ?? null,
      currency: 'IDR',
      dataLineage: {
        sourceId: parsedData.sourceId,
        rawDocumentId: parsedData.rawDocumentId,
        rawEvidenceHash: sha256(JSON.stringify(parsedData.rawEvidence || parsedData.rawDocumentId)),
        extractionMethod: 'blibli-html-parser-v1.0',
        observedAt: parsedData.extractedAt,
        confidence: parsedData.extractionConfidence || 0,
        evidenceHierarchyLevel: 3,
      },
    };
  }

  async healthCheck(): Promise<SourceHealthStatus> {
    try {
      const start = Date.now();
      const response = await this.fetchWithRetry(this.baseUrl, {
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
      });
      const latency = Date.now() - start;
      return {
        isHealthy: response.status === 200,
        statusCode: response.status,
        latencyMs: latency,
        errorMessage: response.status === 200 ? null : `HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
        errorCount24h: 0,
      };
    } catch (err) {
      return {
        isHealthy: false,
        statusCode: null,
        latencyMs: null,
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        checkedAt: new Date().toISOString(),
        errorCount24h: 1,
      };
    }
  }

  getMetadata(): SourceMetadata {
    return {
      id: '',
      name: this.sourceName,
      adapterName: this.adapterName,
      baseUrl: this.baseUrl,
      isActive: this.isActive,
      trustTier: this.trustTier,
      createdAt: new Date().toISOString(),
    };
  }

  getCapabilities(): CapabilityMatrix {
    return {
      supportsDiscover: false,
      supportsSearch: true,
      supportsFetch: true,
      supportsParse: true,
      supportsNormalize: true,
      supportsHealthCheck: true,
      extras: {
        region: 'ID',
        defaultLanguage: 'id',
        supportsVouchers: true,
        supportsFlashSales: true,
      },
    };
  }
}
