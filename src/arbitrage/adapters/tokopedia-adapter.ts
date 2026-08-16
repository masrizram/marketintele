/**
 * Tokopedia Marketplace Adapter (v2 — real implementation)
 *
 * Adapts Tokopedia's public product listings for the arbitrage engine.
 * Tokopedia: https://www.tokopedia.com/
 *
 * Uses Tokopedia's public search page scraping approach.
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

export class TokopediaAdapter extends BaseSourceAdapter {
  readonly adapterName = 'TokopediaAdapter';
  readonly sourceName = 'Tokopedia';
  readonly baseUrl = 'https://www.tokopedia.com';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'tokopedia' as const;

  private readonly searchApiUrl = 'https://gql.tokopedia.com/api/v1/graphql';
  private readonly requestTimeoutMs = 15000;

  constructor() {
    super();
  }

  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[Tokopedia] Searching for: "${query}"`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[Tokopedia] Empty query provided');
      return [];
    }

    try {
      // Tokopedia uses a GraphQL API for search
      const encodedQuery = encodeURIComponent(query.trim());

      // Try fetching the search results page
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/search?q=${encodedQuery}&sc=product`,
        {
          method: 'GET',
          timeout: this.requestTimeoutMs,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'id-ID,id;q=0.9',
            'Referer': 'https://www.tokopedia.com/',
          },
          responseType: 'text',
        }
      );

      if (response.status !== 200) {
        this.logger.error(`[Tokopedia] HTTP ${response.status} on search for "${query}"`);
        return [];
      }

      // Extract product data from the page's embedded JSON
      const results = this.parseSearchResults(response.data as string);
      this.logger.info(`[Tokopedia] Found ${results.length} results for "${query}"`);
      return results as unknown as RawResultSet;
    } catch (err) {
      this.logger.error(`[Tokopedia] Search error for "${query}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Parse search results from Tokopedia's HTML page.
   * Extracts product data from embedded JSON-LD or window.__data.
   */
  private parseSearchResults(html: string): unknown[] {
    const results: unknown[] = [];

    // Try to extract from JSON-LD script tags
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/g;
    let match: RegExpExecArray | null;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1].trim());
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item['@type'] === 'Product' || item['@type'] === 'AggregateOffer') {
              results.push({
                url: item.url || item.offers?.url || '',
                title: item.name || '',
                price: item.offers?.price ? Number(item.offers.price) : null,
                currency: item.offers?.priceCurrency || 'IDR',
                seller: null,
                sellerId: null,
                rating: item.aggregateRating?.ratingValue || null,
                reviewCount: item.aggregateRating?.reviewCount || null,
                soldCount: null,
                image: item.image || null,
                productId: item.sku || item['@id'] || null,
                rawMetadata: item,
              });
            }
          }
        } else if (data?.['@type'] === 'Product') {
          results.push({
            url: data.url || '',
            title: data.name || '',
            price: data.offers?.price ? Number(data.offers.price) : null,
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

    // Fallback: try to extract from window.__data or data-testid attributes
    if (results.length === 0) {
      // Look for product cards with data attributes
      const productCardRegex = /<a[^>]*data-testid=["']div[^"']*Product[^"']*["'][^>]*>([^<]+)<\/a>/g;
      let cardMatch: RegExpExecArray | null;
      while ((cardMatch = productCardRegex.exec(html)) !== null) {
        const cardHtml = cardMatch[1];
        const titleMatch = cardHtml.match(/data-testid="[^"]*ProductName[^"]*"[^>]*>([^<]+)</);
        const title = titleMatch ? titleMatch[1].trim() : '';
        if (title) {
          results.push({
            url: '',
            title,
            price: null,
            currency: 'IDR',
            seller: null,
            sellerId: null,
            rating: null,
            reviewCount: null,
            soldCount: null,
            image: null,
            productId: null,
            rawMetadata: { source: 'html-scrape' },
          });
        }
      }
    }

    return results;
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
          'Referer': 'https://www.tokopedia.com/',
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
    const sourceId = rawDocument.sourceId || 'tokopedia';
    const extractedAt = new Date().toISOString();

    // Try to extract structured data
    const html = rawDocument.rawPayload;
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

    if (!structuredData) {
      this.logger.warn(`[Tokopedia] No structured data found in ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'tokopedia-html-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    const entity: ParsedEntity = {
      rawDocumentId: rawDocument.id,
      sourceId,
      extractedAt,
      title: structuredData.name || '',
      brand: structuredData.brand || null,
      model: structuredData.model || null,
      sku: structuredData.sku || null,
      barcode: structuredData.barcode || structuredData.mpn || null,
      category: structuredData.category || structuredData['dc3-category'] || null,
      price: structuredData.offers?.price ? Number(structuredData.offers.price) : null,
      currency: structuredData.offers?.priceCurrency || 'IDR',
      moq: 1,
      packageQuantity: 1,
      packageUnit: 'pcs',
      supplierName: structuredData.seller?.name || structuredData.seller?.displayName || null,
      supplierType: 'RESELLER',
      marketplace: 'tokopedia',
      sellerId: structuredData.seller?.id ? String(structuredData.seller.id) : null,
      sellerName: structuredData.seller?.name || structuredData.seller?.displayName || null,
      rating: structuredData.aggregateRating?.ratingValue || null,
      reviewCount: structuredData.aggregateRating?.reviewCount || null,
      soldCount: structuredData.soldCount || null,
      rawEvidence: {
        url: rawDocument.url,
        description: structuredData.description || null,
        offers: structuredData.offers || null,
      },
      extractionConfidence: 0.7,
    };

    return {
      rawDocumentId: rawDocument.id,
      entities: [entity],
      extractionMethod: 'tokopedia-html-parser-v1.0',
      extractionConfidence: 0.7,
    };
  }

  async normalize(parsedData: ParsedEntity): Promise<CanonicalProduct> {
    const priceIdr = parsedData.price ?? null;

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
      dataLineage: {
        sourceId: parsedData.sourceId,
        rawDocumentId: parsedData.rawDocumentId,
        rawEvidenceHash: sha256(JSON.stringify(parsedData.rawEvidence || parsedData.rawDocumentId)),
        extractionMethod: 'tokopedia-html-parser-v1.0',
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
