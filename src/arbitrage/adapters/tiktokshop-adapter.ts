/**
 * TikTok Shop Indonesia Marketplace Adapter (v2 — real implementation)
 *
 * TikTok Shop Indonesia: https://www.tiktok.com/shop
 *
 * Uses TikTok's public search page scraping approach.
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

export class TikTokShopAdapter extends BaseSourceAdapter {
  readonly adapterName = 'TikTokShopIDAdapter';
  readonly sourceName = 'TikTok Shop Indonesia';
  readonly baseUrl = 'https://www.tiktok.com';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'tiktok_shop' as const;
  /** Phase 19.3: TikTok Shop uses HTML scraping — REAL_PUBLIC_WEB. */
  readonly dataProvenance = 'REAL_PUBLIC_WEB' as const;
  readonly acquisitionMethod = 'PUBLIC_WEB' as const;
  readonly reliabilityTier = 'C' as const;

  private readonly requestTimeoutMs = 15000;

  constructor() {
    super();
  }

  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[TikTokShop] Searching for: "${query}"`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[TikTokShop] Empty query provided');
      return [];
    }

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const url = `https://www.tiktok.com/search?i=ID&q=${encodedQuery}`;

      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        timeout: this.requestTimeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://www.tiktok.com/',
        },
        responseType: 'text',
      });

      if (response.status !== 200) {
        this.logger.error(`[TikTokShop] HTTP ${response.status} on search for "${query}"`);
        return [];
      }

      const html = response.data as string;
      const results = this.parseSearchResults(html, query);
      this.logger.info(`[TikTokShop] Found ${results.length} results for "${query}"`);
      return results as unknown as RawResultSet;
    } catch (err) {
      this.logger.error(`[TikTokShop] Search error for "${query}":`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Parse TikTok search results from HTML.
   * TikTok embeds product data in __NEXT_DATA__ JSON.
   */
  private parseSearchResults(html: string, _query: string): unknown[] {
    const results: unknown[] = [];

    // TikTok Shop search results
    const nextDataRegex = /<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/g;
    let match: RegExpExecArray | null;

    while ((match = nextDataRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1].trim());
        const hits = data?.props?.pageProps?.hits ||
                     data?.props?.pageProps?.searchResult?.data?.globalDataStore?.hits ||
                     data?.props?.pageProps?.products ||
                     data?.query;

        if (hits && Array.isArray(hits)) {
          for (const hit of hits) {
            if (hit.type === 'product' || hit.productId || hit.goodsId) {
              const product = hit.product || hit;
              results.push({
                url: hit.url || hit.detailUrl || hit.productUrl || (product ? `https://www.tiktok.com/product/${product.goodsId || product.productId}` : ''),
                title: product?.title || product?.name || hit.title || '',
                price: this.toMicroPrice(product?.price) ?? (hit.price != null ? this.toMicroPrice(hit.price) : null),
                currency: 'IDR',
                seller: product?.sellerName || product?.merchantName || hit.sellerName || null,
                sellerId: product?.merchantId ? String(product.merchantId) : null,
                rating: product?.rating ? Number(product.rating) : null,
                reviewCount: product?.reviewCount ? Number(product.reviewCount) : null,
                soldCount: product?.soldCount || product?.salesTip || null,
                image: product?.imgUrl || product?.image || hit.image || null,
                itemId: product?.goodsId || product?.itemId || hit.id ? String(product?.goodsId || product?.itemId || hit.id) : null,
                categoryId: null,
                rawMetadata: hit,
              });
            }
          }
        }
      } catch {
        // Continue
      }
    }

    // Fallback: JSON-LD
    if (results.length === 0) {
      const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/g;
      let ldMatch: RegExpExecArray | null;
      while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
        try {
          const data = JSON.parse(ldMatch[1].trim());
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

  private toMicroPrice(value: unknown): number | null {
    const n = this.toFiniteNumber(value);
    return n === null ? null : n / 100000;
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
          'Referer': 'https://www.tiktok.com/',
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
    const sourceId = rawDocument.sourceId || 'tiktok_shop';
    const extractedAt = new Date().toISOString();
    const html = rawDocument.rawPayload;

    // Try __NEXT_DATA__
    const nextDataRegex = /<script[^>]*id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/g;
    let structuredData: any = null;
    let match: RegExpExecArray | null;

    while ((match = nextDataRegex.exec(html)) !== null) {
      try {
        const data = JSON.parse(match[1].trim());
        const productInfo =
          data?.props?.pageProps?.itemInfo ||
          data?.props?.pageProps?.productInfo ||
          data?.props?.pageProps?.product ||
          data?.query;

        if (productInfo) {
          structuredData = productInfo;
          break;
        }
      } catch {
        // Continue
      }
    }

    // Fallback: JSON-LD
    if (!structuredData) {
      const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([^<]+)<\/script>/g;
      let ldMatch: RegExpExecArray | null;
      while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
        try {
          const data = JSON.parse(ldMatch[1].trim());
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
      this.logger.warn(`[TikTokShop] No structured data found in ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'tiktokshop-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    const info = structuredData;

    const entity: ParsedEntity = {
      rawDocumentId: rawDocument.id,
      sourceId,
      extractedAt,
      title: info.name || info.title || '',
      brand: info.brand || info.brandName || null,
      model: info.model || null,
      sku: info.sku || info.code || null,
      barcode: info.barcode || info.ean || info.upc || null,
      category: info.categoryId ? String(info.categoryId) : (info.category ? String(info.category) : null),
      price: info.price ? this.toFiniteNumber(info.price) : (info.skuPrice ? this.toFiniteNumber(info.skuPrice) : null),
      currency: info.currency || 'IDR',
      moq: 1,
      packageQuantity: 1,
      packageUnit: 'pcs',
      supplierName: info.sellerName || info.merchantName || info.storeName || null,
      supplierType: 'RESELLER',
      marketplace: 'tiktok_shop',
      sellerId: info.sellerId ? String(info.sellerId) : (info.merchantId ? String(info.merchantId) : null),
      sellerName: info.sellerName || info.merchantName || null,
      rating: info.rating ? Number(info.rating) : null,
      reviewCount: info.reviewCount ? Number(info.reviewCount) : null,
      soldCount: info.soldCount || info.salesTip || null,
      rawEvidence: {
        url: rawDocument.url,
        description: info.description || null,
        catId: info.catId || null,
        discountPrice: info.discountPrice || null,
      },
      extractionConfidence: info.name ? 0.7 : 0,
    };

    return {
      rawDocumentId: rawDocument.id,
      entities: [entity],
      extractionMethod: 'tiktokshop-parser-v1.0',
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
        extractionMethod: 'tiktokshop-parser-v1.0',
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
        supportsLiveShopping: true,
      },
    };
  }
}
