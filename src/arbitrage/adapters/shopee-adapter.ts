/**
 * Shopee Indonesia Marketplace Adapter (v2 — real implementation)
 *
 * This adapter fetches product listings from Shopee's public web interface
 * and parses them into canonical product data. It does NOT fabricate data.
 *
 * Shopee Indonesia: https://shopee.co.id/
 *
 * Public search API endpoint:
 *   https://shopee.co.id/api/v2/search_items/
 *   (returns JSON with product list)
 *
 * Product page:
 *   https://shopee.co.id/<product-name>-i.<shop-id>.<item-id>
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

export class ShopeeAdapter extends BaseSourceAdapter {
  readonly adapterName = 'ShopeeIndonesiaAdapter';
  readonly sourceName = 'Shopee Indonesia';
  readonly baseUrl = 'https://shopee.co.id';
  readonly trustTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN' = 'MEDIUM';
  readonly isActive = true;
  readonly marketplace = 'shopee' as const;

  /** Shopee public API search endpoint */
  private readonly searchApiUrl = 'https://shopee.co.id/api/v2/search_items/';
  private readonly productApiUrl = 'https://shopee.co.id/api/v4/pdp/get_pc/';
  private readonly requestTimeoutMs = 15000;

  constructor() {
    super();
  }

  /**
   * Search Shopee for products matching a query.
   *
   * Uses Shopee's public search API. Returns actual product listings or
   * an empty array with a clear status if no results are found.
   * Never returns fabricated data.
   */
  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[Shopee] Searching for: "${query}"`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[Shopee] Empty query provided');
      return [];
    }

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const url = `${this.searchApiUrl}?by=relevance&keyword=${encodedQuery}&limit=10&order=ASC&page_type=search&version=2`;

      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        timeout: this.requestTimeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://shopee.co.id/',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (response.status !== 200) {
        this.logger.error(`[Shopee] HTTP ${response.status} on search for "${query}"`);
        return [];
      }

      const data = response.data;
      if (!data || !Array.isArray(data.items)) {
        this.logger.warn('[Shopee] No items array in API response');
        return [];
      }

      if (data.items.length === 0) {
        this.logger.info(`[Shopee] Empty result for "${query}"`);
        return [];
      }

      // Map Shopee's raw item format to our RawResultSet entries
      const results = data.items.map((item: any) => ({
        url: this.buildProductUrl(item),
        title: item.name || '',
        price: this.extractPrice(item),
        currency: 'IDR',
        seller: item.seller?.shopLocation || item.seller?.shopName || null,
        sellerId: item.seller?.shopid ? String(item.seller?.shopid) : null,
        rating: item.item_rating?.rating_star || null,
        reviewCount: item.item_rating?.rating_count || null,
        soldCount: item.soldout ? 0 : (item.historical_sold || null),
        image: item.image_hases ? `https://cf.shopee.co.id/file/${item.image_hases}` : null,
        categoryId: item.catid ? String(item.catid) : null,
        itemId: item.itemid ? String(item.itemid) : null,
        shopId: item.seller?.shopid ? String(item.seller?.shopid) : null,
        rawMetadata: item,
      }));

      this.logger.info(`[Shopee] Found ${results.length} results for "${query}"`);
      return results as unknown as RawResultSet;
    } catch (err) {
      if (err instanceof Error && (err.message.includes('timeout') || err.message.includes('TIMEOUT'))) {
        this.logger.error(`[Shopee] Timeout searching "${query}"`);
      } else {
        this.logger.error(`[Shopee] Search error for "${query}":`, { error: err instanceof Error ? err.message : String(err) });
      }
      return [];
    }
  }

  /**
   * Build the product URL from a Shopee API item.
   */
  private buildProductUrl(item: any): string {
    if (item.itemid && item.seller?.shopid) {
      return `https://shopee.co.id/${encodeURIComponent(item.name || '')}-i.${item.seller.shopid}.${item.itemid}`;
    }
    return '';
  }

  /**
   * Extract price from Shopee item. Shopee stores price in micro-units (divide by 100000).
   */
  private extractPrice(item: any): number | null {
    if (item.price !== undefined && item.price !== null && !isNaN(Number(item.price))) {
      return Number(item.price) / 100000;
    }
    if (item.price_before_discount !== undefined && item.price_before_discount !== null && !isNaN(Number(item.price_before_discount))) {
      return Number(item.price_before_discount) / 100000;
    }
    if (item.price_max !== undefined && !isNaN(Number(item.price_max))) {
      return Number(item.price_max) / 100000;
    }
    return null;
  }

  /**
   * Fetch a specific product URL and return the raw payload.
   */
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
          'Accept': 'text/html',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://shopee.co.id/',
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

  /**
   * Parse raw HTML/JSON into ParsedEntity objects.
   *
   * Attempts to extract product data from Shopee's product page HTML.
   * Uses regex-based extraction on embedded JSON scripts.
   * If no structured data is found, returns empty entities (never fabricated).
   */
  async parse(rawDocument: RawDocument): Promise<ParsedEntities> {
    const sourceId = rawDocument.sourceId || 'shopee';
    const extractedAt = new Date().toISOString();

    // Extract JSON from <script> tags using regex (no cheerio dependency)
    const jsonScriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([^<]+)<\/script>/g;
    let structuredData: any = null;
    let match: RegExpExecArray | null;

    while ((match = jsonScriptRegex.exec(rawDocument.rawPayload)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed?.props?.pageProps?.itemInfo || parsed?.query || parsed?.productInfo) {
          structuredData = parsed;
          break;
        }
      } catch {
        // Continue to next script
      }
    }

    // Also check for window.__define__ style data
    if (!structuredData) {
      const definePattern = /window\.__define__\s*=\s*(\{.+?\})\s*;?\s*<\/script>/;
      const defineMatch = rawDocument.rawPayload.match(definePattern);
      if (defineMatch) {
        try {
          structuredData = JSON.parse(defineMatch[1]);
        } catch {
          // continue
        }
      }
    }

    if (!structuredData) {
      this.logger.warn(`[Shopee] No structured data found in ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'shopee-html-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    // Try to extract product info from various possible locations
    const itemInfo =
      structuredData?.props?.pageProps?.itemInfo ||
      structuredData?.pageProps?.itemInfo ||
      structuredData?.productInfo ||
      structuredData?.query;

    if (!itemInfo) {
      this.logger.warn(`[Shopee] Product info not found in structured data for ${rawDocument.url}`);
      return {
        rawDocumentId: rawDocument.id,
        entities: [],
        extractionMethod: 'shopee-html-parser-v1.0',
        extractionConfidence: 0,
      };
    }

    const entity: ParsedEntity = {
      rawDocumentId: rawDocument.id,
      sourceId,
      extractedAt,
      title: itemInfo.name || itemInfo.title || '',
      brand: itemInfo.brand || itemInfo.brand_id || null,
      model: itemInfo.model || null,
      sku: itemInfo.sku || null,
      barcode: itemInfo.barcode || null,
      category: itemInfo.catid ? String(itemInfo.catid) : null,
      price: this.extractPrice(itemInfo),
      currency: 'IDR',
      moq: itemInfo.package_option?.package_quantity || 1,
      packageQuantity: itemInfo.package_option?.package_quantity || 1,
      packageUnit: 'pcs',
      supplierName: itemInfo.seller?.shopName || itemInfo.seller?.username || null,
      supplierType: 'RESELLER',
      marketplace: 'shopee',
      sellerId: itemInfo.seller?.shopid ? String(itemInfo.seller?.shopid) : null,
      sellerName: itemInfo.seller?.shopName || null,
      rating: itemInfo.item_rating?.rating_star || null,
      reviewCount: itemInfo.item_rating?.rating_count || null,
      soldCount: itemInfo.historical_sold || null,
      rawEvidence: {
        url: rawDocument.url,
        priceBeforeDiscount: itemInfo.price_before_discount ? itemInfo.price_before_discount / 100000 : null,
        discount: itemInfo.discount || null,
        stock: itemInfo.stock || null,
        condition: itemInfo.condition || null,
        description: itemInfo.description || null,
      },
      extractionConfidence: 0.8,
    };

    return {
      rawDocumentId: rawDocument.id,
      entities: [entity],
      extractionMethod: 'shopee-html-parser-v1.0',
      extractionConfidence: 0.8,
    };
  }

  /**
   * Normalize a parsed Shopee entity into the canonical product schema.
   *
   * Currency: Shopee IDR → already IDR
   * Unit: Shopee sells in "pcs" (packets) — standard unit is "pcs"
   * Price: normalized to IDR per unit
   */
  async normalize(parsedData: ParsedEntity): Promise<CanonicalProduct> {
    const priceIdr = parsedData.price ?? null;

    return {
      id: ulid(),
      canonicalTitle: parsedData.title,
      brand: parsedData.brand,
      model: parsedData.model,
      categoryId: null,  // Set from parsedData.category in a real impl
      standardUnit: 'pcs',
      standardWeightGrams: null,    // Shopee doesn't expose weight in listing
      standardDimensionsCm: null,
      sku: parsedData.sku,
      barcode: parsedData.barcode,
      priceInIdr: priceIdr,
      currencyConverted: priceIdr !== null,
      moq: parsedData.moq ?? 1,
      packageQuantity: parsedData.packageQuantity ?? 1,
      packageUnit: parsedData.packageUnit || 'pcs',
      sourceId: parsedData.sourceId,
      supplierProductId: null,      // Not resolved yet — separate supplier discovery step
      marketplaceListingId: null,   // Could be set from itemid
      sellerId: parsedData.sellerId || null,
      sellerName: parsedData.sellerName || null,
      marketplaceListingUrl: null,
      observedAt: parsedData.extractedAt,
      confidence: parsedData.extractionConfidence || 0,
      dataLineage: {
        sourceId: parsedData.sourceId,
        rawDocumentId: parsedData.rawDocumentId,
        rawEvidenceHash: sha256(JSON.stringify(parsedData.rawEvidence || parsedData.rawDocumentId)),
        extractionMethod: 'shopee-html-parser-v1.0',
        observedAt: parsedData.extractedAt,
        confidence: parsedData.extractionConfidence || 0,
        evidenceHierarchyLevel: 3,
      },
    };
  }

  async healthCheck(): Promise<SourceHealthStatus> {
    try {
      const start = Date.now();
      const url = 'https://shopee.co.id';
      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        timeout: 10000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
