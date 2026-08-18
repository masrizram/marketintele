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
  /** Phase 19.3: Shopee uses a public web search page — REAL_PUBLIC_WEB. */
  readonly dataProvenance = 'REAL_PUBLIC_WEB' as const;
  readonly acquisitionMethod = 'PUBLIC_WEB' as const;
  readonly reliabilityTier = 'C' as const;

  /** Shopee search page URL (v2 API deprecated — returns 404) */
  private readonly searchPageUrl = 'https://shopee.co.id/search';
  private readonly requestTimeoutMs = 15000;

  constructor() {
    super();
  }

  /**
   * Search Shopee for products matching a query.
   *
   * The Shopee v2 search API (api/v2/search_items/) is deprecated (returns
   * HTTP 404). The v4 API returns HTTP 403 (anti-bot, requires auth token).
   * This method fetches the search page HTML and attempts to extract
   * product data from embedded JSON. If the page is JS-rendered (no embedded
   * product data), it throws a SOURCE_BLOCKED error — never fabricates.
   */
  async search(query: string, _filters?: Record<string, unknown>): Promise<RawResultSet> {
    this.logger.info(`[Shopee] Searching for: "${query}"`);

    if (!query || query.trim().length === 0) {
      this.logger.warn('[Shopee] Empty query provided');
      return [];
    }

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const url = `${this.searchPageUrl}?keyword=${encodedQuery}`;

      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        timeout: this.requestTimeoutMs,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Referer': 'https://shopee.co.id/',
        },
        responseType: 'text',
      });

      if (response.status !== 200) {
        this.logger.error(`[Shopee] HTTP ${response.status} on search page for "${query}"`);
        throw new Error(`Shopee search page returned HTTP ${response.status} — source may be blocked`);
      }

      const html: string = typeof response.data === 'string' ? response.data : '';

      // Attempt to extract product data from embedded JSON in the HTML.
      // Shopee's search page is a Next.js SPA — product data may be in
      // __NEXT_DATA__ or a window.__ script block.
      const results = this.extractProductsFromHtml(html, query);

      if (results.length === 0) {
        this.logger.warn(`[Shopee] No product data found in search page HTML for "${query}" — page is JS-rendered, no embedded product data`);
        throw new Error('Shopee search page is JS-rendered (no embedded product data) — API endpoints deprecated/blocked (v2=404, v4=403)');
      }

      this.logger.info(`[Shopee] Found ${results.length} results for "${query}"`);
      return results as unknown as RawResultSet;
    } catch (err) {
      if (err instanceof Error && (err.message.includes('timeout') || err.message.includes('TIMEOUT'))) {
        this.logger.error(`[Shopee] Timeout searching "${query}"`);
        throw err;
      }
      // Re-throw so discovery service classifies as SOURCE_ERROR, not EMPTY_RESULT
      throw err;
    }
  }

  /**
   * Extract product data from Shopee search page HTML.
   * Looks for __NEXT_DATA__ JSON or window.__ script blocks.
   * Never fabricates — returns empty array if no structured data found.
   */
  private extractProductsFromHtml(html: string, _query: string): RawResultSet {
    // Try __NEXT_DATA__ (Next.js hydration data)
    const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nd = JSON.parse(nextDataMatch[1]);
        const items = nd?.props?.pageProps?.search?.results || nd?.props?.pageProps?.initial?.results || [];
        if (Array.isArray(items) && items.length > 0) {
          return items.map((item: any) => ({
            url: this.buildProductUrl(item),
            title: item.name || '',
            price: this.extractPrice(item),
            currency: 'IDR',
            seller: item.seller?.shopName || null,
            sellerId: item.seller?.shopid ? String(item.seller.shopid) : null,
            rating: item.item_rating?.rating_star || null,
            reviewCount: item.item_rating?.rating_count || null,
            soldCount: item.historical_sold || null,
            image: item.image_hases ? `https://cf.shopee.co.id/file/${item.image_hases}` : null,
            itemId: item.itemid ? String(item.itemid) : null,
            shopId: item.seller?.shopid ? String(item.seller.shopid) : null,
            rawMetadata: item,
          })) as unknown as RawResultSet;
        }
      } catch { /* parse failed — continue */ }
    }

    // No embedded product data found — the page is JS-rendered
    return [];
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
   * Returns a finite number or null — never NaN / Infinity / a non-numeric value.
   */
  private extractPrice(item: any): number | null {
    const micro = this.toFiniteNumber(item?.price)
      ?? this.toFiniteNumber(item?.price_before_discount)
      ?? this.toFiniteNumber(item?.price_max);
    return micro === null ? null : micro / 100000;
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
    const priceIdr =
      typeof parsedData.price === 'number' && Number.isFinite(parsedData.price)
        ? parsedData.price
        : null;
    const retrievedAt = new Date().toISOString();
    const rawEvidence = parsedData.rawEvidence || {};
    const listingUrl = (rawEvidence.url as string) || null;
    const priceBeforeDiscount = typeof rawEvidence.priceBeforeDiscount === 'number'
      ? rawEvidence.priceBeforeDiscount
      : null;
    const discountPercent = rawEvidence.discount != null && priceIdr != null && priceBeforeDiscount != null && priceBeforeDiscount > 0
      ? Math.round(((priceBeforeDiscount - priceIdr) / priceBeforeDiscount) * 100)
      : null;

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
      originalPriceIdr: priceBeforeDiscount,
      discountPercent,
      availability: rawEvidence.stock != null ? String(rawEvidence.stock) : null,
      currency: 'IDR',
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
