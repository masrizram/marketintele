/**
 * Discovery Service — orchestrates the initial marketplace search.
 *
 * Selects the appropriate source adapter based on marketplace preference,
 * executes the search with a timeout, and returns a structured result.
 *
 * Never fabricates data. Empty results are explicitly categorized.
 */
import { adapterRegistry } from '../adapters/registry';
import { CanonicalProduct } from '../types';
import { sha256 } from '../lib/hash';
import {
  DiscoveryResult,
  PipelineContext,
} from './types';
import { createRequestLogger } from './logger';

export class DiscoveryService {
  private readonly defaultTimeoutMs = 30000;

  /**
   * Run discovery for a given query and marketplace.
   *
   * The adapter's `search()` method returns raw results. We then invoke
   * the adapter's `fetch` + `parse` + `normalize` chain on the first
   * few results to produce CanonicalProduct objects.
   */
  async discover(
    context: PipelineContext,
    query: string,
    marketplace: string | null,
    timeoutMs: number = this.defaultTimeoutMs,
  ): Promise<DiscoveryResult> {
    const reqLogger = createRequestLogger(context.requestId);
    reqLogger.info('Discovery started', { query, marketplace });

    const start = Date.now();

    // Select adapter
    const adapter = marketplace
      ? adapterRegistry.getByMarketplace(marketplace)
      : adapterRegistry.getActive()[0];

    if (!adapter) {
      reqLogger.error('No suitable adapter found', { marketplace });
      return {
        requestId: context.requestId,
        status: 'SOURCE_ERROR',
        marketplace: marketplace || 'none',
        query,
        products: [],
        error: `No adapter registered for marketplace: ${marketplace || 'any'}`,
        metadata: {
          adapterName: 'none',
          sourceUrl: null,
          elapsedMs: Date.now() - start,
          observedAt: new Date().toISOString(),
        },
      };
    }

    reqLogger.info('Adapter selected', { adapterName: adapter.adapterName, sourceName: adapter.sourceName });

    // Validate query
    if (!query || query.trim().length === 0) {
      return {
        requestId: context.requestId,
        status: 'VALIDATION_ERROR',
        marketplace: (adapter as { marketplace?: string }).marketplace || marketplace || '',
        query,
        products: [],
        error: 'Query is empty or whitespace-only',
        metadata: {
          adapterName: adapter.adapterName,
          sourceUrl: adapter.baseUrl,
          elapsedMs: Date.now() - start,
          observedAt: new Date().toISOString(),
        },
      };
    }

    // Execute search with timeout
    let rawResults: unknown[];
    try {
      const searchPromise = adapter.search(query.trim());
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Discovery timeout after ${timeoutMs}ms`)), timeoutMs),
      );

      const results = await Promise.race([searchPromise, timeoutPromise]);
      rawResults = results as unknown[] as unknown[];
    } catch (err) {
      const elapsedMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (errorMsg.includes('timeout')) {
        reqLogger.error('Discovery timed out', { marketplace, elapsedMs });
        return {
          requestId: context.requestId,
          status: 'TIMEOUT',
          marketplace: (adapter as { marketplace?: string }).marketplace || marketplace || '',
          query,
          products: [],
          error: errorMsg,
          metadata: {
            adapterName: adapter.adapterName,
            sourceUrl: adapter.baseUrl,
            elapsedMs,
            observedAt: new Date().toISOString(),
          },
        };
      }

      reqLogger.error('Discovery source error', { marketplace, error: errorMsg });
      return {
        requestId: context.requestId,
        status: 'SOURCE_ERROR',
        marketplace: (adapter as { marketplace?: string }).marketplace || marketplace || '',
        query,
        products: [],
        error: errorMsg,
        metadata: {
          adapterName: adapter.adapterName,
          sourceUrl: adapter.baseUrl,
          elapsedMs,
          observedAt: new Date().toISOString(),
        },
      };
    }

    // Check for empty results
    if (!rawResults || rawResults.length === 0) {
      reqLogger.info('Discovery returned empty results', { marketplace, query });
      return {
        requestId: context.requestId,
        status: 'EMPTY_RESULT',
        marketplace: (adapter as { marketplace?: string }).marketplace || marketplace || '',
        query,
        products: [],
        error: null,
        metadata: {
          adapterName: adapter.adapterName,
          sourceUrl: adapter.baseUrl,
          elapsedMs: Date.now() - start,
          observedAt: new Date().toISOString(),
        },
      };
    }

    reqLogger.info('Discovery found raw results', { count: rawResults.length, marketplace });

    // Fetch + parse + normalize the top results (limit to 5 for performance)
    const products: CanonicalProduct[] = [];
    const maxProducts = Math.min(rawResults.length, 5);

    for (let i = 0; i < maxProducts; i++) {
      const rawItem = rawResults[i] as any;
      if (!rawItem || !rawItem.url) {
        continue;
      }

      try {
        // Fetch the product page
        const rawPayload = await adapter.fetch(rawItem.url);

        // Create a RawDocument
        const rawDocument: any = {
          id: rawPayload.url, // use URL as ID for simplicity
          sourceId: adapter.adapterName,
          url: rawPayload.url,
          observedAt: rawPayload.observedAt,
          httpStatus: rawPayload.statusCode,
          contentType: rawPayload.contentType,
          contentHash: sha256(rawPayload.body),
          parserVersion: 'v1.0',
          rawPayload: rawPayload.body,
        };

        // Parse
        const parsed = await adapter.parse(rawDocument as any);
        if (!parsed.entities || parsed.entities.length === 0) {
          reqLogger.warn('Parse returned no entities', { url: rawItem.url });
          continue;
        }

        // Normalize (use the first/strongest entity)
        const canonical = await adapter.normalize(parsed.entities[0]);
        if (!canonical) {
          reqLogger.warn('Normalize returned null', { url: rawItem.url });
          continue;
        }

        products.push(canonical);
        reqLogger.info('Product normalized', {
          productId: canonical.id,
          title: canonical.canonicalTitle,
          priceInIdr: canonical.priceInIdr,
          confidence: canonical.confidence,
        });
      } catch (err) {
        reqLogger.warn('Failed to fetch/parse/normalize product', {
          url: rawItem.url,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue with other products
      }
    }

    const elapsedMs = Date.now() - start;
    reqLogger.info('Discovery completed', {
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY_RESULT',
      productsFound: products.length,
      elapsedMs,
    });

    return {
      requestId: context.requestId,
      status: products.length > 0 ? 'SUCCESS' : 'EMPTY_RESULT',
      marketplace: (adapter as { marketplace?: string }).marketplace || marketplace || '',
      query,
      products,
      error: null,
      metadata: {
        adapterName: adapter.adapterName,
        sourceUrl: adapter.baseUrl,
        elapsedMs,
        observedAt: new Date().toISOString(),
      },
    };
  }
}

export const discoveryService = new DiscoveryService();
