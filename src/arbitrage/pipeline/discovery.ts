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
  private readonly defaultTimeoutMs = 90000;

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

    // Select adapter(s)
    // When no marketplace is specified, try all active adapters in priority
    // order until one returns real products (fan-out, first-success).
    const adapters = marketplace
      ? [adapterRegistry.getByMarketplace(marketplace)].filter(Boolean)
      : adapterRegistry.getActive();

    if (adapters.length === 0) {
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

    // Try adapters sequentially until one yields products
    let lastError: string | null = null;
    let lastAdapterName = 'none';
    for (const adapter of adapters.filter(Boolean) as NonNullable<typeof adapters[0]>[]) {
      reqLogger.info('Adapter selected', { adapterName: adapter.adapterName, sourceName: adapter.sourceName });

      // Validate query
      if (!query || query.trim().length === 0) {
        lastError = 'Query is empty or whitespace-only';
        continue;
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
        const errorMsg = err instanceof Error ? err.message : String(err);
        reqLogger.error('Discovery source error', {
          marketplace,
          error: errorMsg,
          adapterName: adapter.adapterName,
          sourceUrl: adapter.baseUrl,
          elapsedMs: Date.now() - start,
        });
        lastError = errorMsg;
        lastAdapterName = adapter.adapterName;
        continue;
      }

      // Check for empty results — try next adapter
      if (!rawResults || rawResults.length === 0) {
        reqLogger.info(`Discovery returned empty results from ${adapter.adapterName}, trying next`, { marketplace, query });
        lastAdapterName = adapter.adapterName;
        continue;
      }

      reqLogger.info('Discovery found raw results', { count: rawResults.length, marketplace, adapterName: adapter.adapterName });

      // Normalize the top results (limit to 5 for performance)
      const products: CanonicalProduct[] = [];
      const maxProducts = Math.min(rawResults.length, 5);

      // Check if the adapter supports fetch (browser adapters throw 'Not supported')
      let adapterSupportsFetch = true;
      try {
        await adapter.fetch(rawResults[0] as any);
      } catch (err) {
        if (err instanceof Error && err.message.includes('Not supported')) {
          adapterSupportsFetch = false;
          reqLogger.info('Adapter does not support fetch — using direct normalize path', { adapter: adapter.adapterName });
        }
      }

      for (let i = 0; i < maxProducts; i++) {
        const rawItem = rawResults[i] as any;
        if (!rawItem) continue;

        try {
          let canonical: CanonicalProduct;

          if (adapterSupportsFetch) {
            if (!rawItem.url) continue;
            const rawPayload = await adapter.fetch(rawItem.url);
            const rawDocument: any = {
              id: rawPayload.url,
              sourceId: adapter.adapterName,
              url: rawPayload.url,
              observedAt: rawPayload.observedAt,
              httpStatus: rawPayload.statusCode,
              contentType: rawPayload.contentType,
              contentHash: sha256(rawPayload.body),
              parserVersion: 'v1.0',
              rawPayload: rawPayload.body,
            };
            const parsed = await adapter.parse(rawDocument as any);
            if (!parsed.entities || parsed.entities.length === 0) {
              reqLogger.warn('Parse returned no entities', { url: rawItem.url });
              continue;
            }
            canonical = await adapter.normalize(parsed.entities[0]);
          } else {
            canonical = await adapter.normalize(rawItem as any);
          }

          if (!canonical) { reqLogger.warn('Normalize returned null', { index: i }); continue; }

          products.push(canonical);
          reqLogger.info('Product normalized', {
            productId: canonical.id, title: canonical.canonicalTitle,
            priceInIdr: canonical.priceInIdr, confidence: canonical.confidence,
            provenance: canonical.dataProvenance, acquisition: canonical.acquisitionMethod,
          });
        } catch (err) {
          reqLogger.warn('Failed to normalize product', { index: i, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const elapsedMsFinal = Date.now() - start;
      reqLogger.info(`event=normalization_completed count=${products.length} elapsedMs=${elapsedMsFinal}`);
      reqLogger.info(`event=discovery_completed count=${products.length} status=${products.length > 0 ? 'SUCCESS' : 'EMPTY_RESULT'} elapsedMs=${elapsedMsFinal}`);

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
          elapsedMs: elapsedMsFinal,
          observedAt: new Date().toISOString(),
        },
      };
    }

    // All adapters tried, none succeeded
    const elapsedFinal = Date.now() - start;
    reqLogger.info('Discovery did not yield products — all adapters exhausted');
    return {
      requestId: context.requestId,
      status: 'SOURCE_ERROR',
      marketplace: marketplace || 'any',
      query,
      products: [],
      error: lastError || 'All adapters returned empty results',
      metadata: {
        adapterName: lastAdapterName,
        sourceUrl: null,
        elapsedMs: elapsedFinal,
        observedAt: new Date().toISOString(),
      },
    };
  }
}

export const discoveryService = new DiscoveryService();
