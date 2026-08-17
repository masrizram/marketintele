/**
 * Lazada Indonesia Marketplace Adapter (v2 — real implementation)
 *
 * Lazada Indonesia: https://www.lazada.co.id/
 *
 * Uses Lazada's public search page and product API endpoints.
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

export class LazadaAdapter extends BaseSourceAdapter {
  readonly adapterName = 'LazadaIDAdapter';
  readonly sourceName = 'Lazada Indonesia';
  readonly baseUrl = 'https://www.lazada.co.id';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'lazada' as const;
  /** Phase 19.3: Lazada uses HTML scraping — REAL_PUBLIC_WEB. */
  readonly dataProvenance = 'REAL_PUBLIC_WEB' as const;
  readonly acquisitionMethod = 'PUBLIC_WEB' as const;
  readonly reliabilityTier = 'C' as const;

  private readonly requestTimeoutMs = 15000;

  constructor() {
    super();
  }

  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[Lazada] Searching for: "${query}"`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[Lazada] Empty query provided');
      return [];
    }

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const url = `${this.baseUrl}/catalog/?q=${encodedQuery}`;

      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        timeout: this.requestTimeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://www.lazada.co.id/',
        },
        responseType: 'text',
      });

      if (response.status !== 200) {
        this.logger.error(`[Lazada] HTTP ${response.status} on search for "${query}"`);
        return [];
      }

      const results = this.parseSearchResults(response.data as string);
      this.logger.info(`[Lazada] Found ${results.length} results for "${query}"`);
      return results as unknown as RawResultSet;
    } catch (err) {
      this.logger.error(`[Lazada] Search error for "${query}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Parse Lazada search results from HTML.
   * Lazada embeds product data in window.appData (JSON).
   */
  private parseSearchResults(html: string): unknown[] {
    const results: unknown[] = [];

    // Lazada embeds data in window.appData
    const appDataRegex = /window\.appData\s*=\s*(\{[^]+?\})\s*;?/;
    const appDataMatch = html.match(appDataRegex);
    if (appDataMatch) {
      try {
        const appData = JSON.parse(appDataMatch[1]);
        const items = appData?.data?.root?.docs?.items || appData?.data?.items;
        if (Array.isArray(items)) {
          for (const item of items) {
            results.push({
              url: item.url || item.itemDetailUrl || `https://www.lazada.co.id/products/${item.itemId}-i-${item.itemId}.html`,
              title: item.name || '',
              price: item.price ? this.toFiniteNumber(item.price) : null,
              currency: 'IDR',
              seller: item.sellerName || null,
              sellerId: item.sellerId ? String(item.sellerId) : null,
              rating: item.rating ? { star: item.rating.star, score: item.rating.score } : null,
              reviewCount: item.reviewCount || null,
              soldCount: null,
              image: item.image || item.img || null,
              itemId: item.itemId ? String(item.itemId) : null,
              categoryId: item.categoryId ? String(item.categoryId) : null,
              rawMetadata: item,
            });
          }
        }
      } catch {
        // Continue to fallback
      }
    }

    // Fallback: try JSON-LD
    if (results.length === 0) {
      const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/g;
      let match: RegExpExecArray | null;
      while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
          const data = JSON.parse(match[1].trim());
          if (data?.['@type'] === 'Product') {
            results.push({
              url: data.url || '',
              title: data.name || '',
              price: data.offers?.price ? this.toFiniteNumber(data.offers.price) : null,
              currency: data.offers?.priceCurrency || 'IDR',
              seller: null,
              sellerId: null,
              rating: data.aggregateRating?.ratingValue || null,
              reviewCount: data.aggregateRating?.reviewCount || null,
              soldCount: null,
              image: data.image || null,
              productId: data.sku || data['@id'] || null,
              rawMetadata: data,
            });
          }
        } catch {
          // Continue
        }
      }
    }

    return results;
  }

  private toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
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
          'Referer': 'https://www.lazada.co.id/',
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
    const sourceId = rawDocument.sourceId || 'lazada';
    const extractedAt = new Date().toISOString();

    // Try to extract structured data
    const html = rawDocument.rawPayload;
    const appDataRegex = /window\.appData\s*=\s*(\{[^]+?\})\s*;?/;
    const appDataMatch = html.match(appDataRegex);
    let structuredData: any = null;

    if (appDataMatch) {
      try {
        structuredData = JSON.parse(appDataMatch[1]);
      } catch {
        // continue
      }
    }

    // Fallback: JSON-LD
    if (!structuredData) {
      const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/g;
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
    }

    if (!structuredData) {
      this.logger.warn(`[Lazada] No structured data found in ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'lazada-html-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    // Extract product info from appData or JSON-LD
    const productInfo =
      structuredData?.data?.root?.view?.content?.[0]?.data?.productInfo ||
      structuredData?.data?.root?.docs?.items?.[0] ||
      structuredData?.data || // fallback to direct
      structuredData;

    if (!productInfo) {
      this.logger.warn(`[Lazada] Product info not found in structured data for ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'lazada-html-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    const entity: ParsedEntity = {
      rawDocumentId: rawDocument.id,
      sourceId,
      extractedAt,
      title: productInfo.name || productInfo.title || productInfo.titleInfo?.title || '',
      brand: productInfo.brand || productInfo.brandValue || null,
      model: productInfo.model || null,
      sku: productInfo.sku || productInfo.itemSku || null,
      barcode: productInfo.barcode || productInfo.mdv || null,
      category: productInfo.categoryId ? String(productInfo.categoryId) : null,
      price: productInfo.price ? this.toFiniteNumber(productInfo.price) : (productInfo.assemblePrice ? this.toFiniteNumber(productInfo.assemblePrice) : null),
      currency: 'IDR',
      moq: productInfo.packageValue?.packageCount || 1,
      packageQuantity: productInfo.packageValue?.packageCount || 1,
      packageUnit: 'pcs',
      supplierName: productInfo.sellerName || productInfo.storeName || null,
      supplierType: 'RESELLER',
      marketplace: 'lazada',
      sellerId: productInfo.sellerId ? String(productInfo.sellerId) : null,
      sellerName: productInfo.sellerName || productInfo.storeName || null,
      rating: productInfo.ratingScore || null,
      reviewCount: productInfo.reviewCount || productInfo.evaluateCount || null,
      soldCount: null,
      rawEvidence: {
        url: rawDocument.url,
        itemId: productInfo.itemId || productInfo.item_id || null,
        priceSuccess: productInfo.priceSuccess || null,
        flashSale: productInfo.flashSale || null,
        voucherInfo: productInfo.voucherInfo || null,
      },
      extractionConfidence: productInfo.name ? 0.75 : 0,
    };

    return {
      rawDocumentId: rawDocument.id,
      entities: [entity],
      extractionMethod: 'lazada-html-parser-v1.0',
      extractionConfidence: entity.extractionConfidence ?? 0,
    };
  }

  async normalize(parsedData: ParsedEntity): Promise<CanonicalProduct> {
    const priceIdr =
      typeof parsedData.price === 'number' && Number.isFinite(parsedData.price)
        ? parsedData.price
        : null;
    const retrievedAt = new Date().toISOString();

    return {
      id: ulid(),
      canonicalTitle: parsedData.title,
      brand: parsedData.brand,
      model: parsedData.model,
      categoryId: parsedData.category ? parsedData.category : null,
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
      marketplaceListingUrl: null,
      observedAt: parsedData.extractedAt,
      confidence: parsedData.extractionConfidence || 0,
      dataProvenance: this.dataProvenance,
      acquisitionMethod: this.acquisitionMethod,
      retrievedAt,
      dataLineage: {
        sourceId: parsedData.sourceId,
        rawDocumentId: parsedData.rawDocumentId,
        rawEvidenceHash: sha256(JSON.stringify(parsedData.rawEvidence || parsedData.rawDocumentId)),
        extractionMethod: 'lazada-html-parser-v1.0',
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
