/**
 * Adapter registry — manages all source adapters and provides lookup.
 */
import { SourceAdapter, MarketplaceSource } from '../types';
import { logger } from '../lib/logger';
import { DataProvenanceCategory, isProductionEligibleProvenance } from '../provenance/data-provenance';

import { ShopeeAdapter } from './shopee-adapter';
import { TokopediaBrowserAdapter } from './tokopedia-browser-adapter';
import { LazadaBrowserAdapter } from './lazada-browser-adapter';
import { BlibliAdapter } from './blibli-adapter';
import { TikTokShopAdapter } from './tiktokshop-adapter';

export class MarketplaceAdapterRegistry {
  private adapters: SourceAdapter[] = [];

  register(adapter: SourceAdapter): void {
    this.adapters.push(adapter);
    logger.info(`Registered adapter: ${adapter.adapterName} (${adapter.sourceName})`);
  }

  getAll(): SourceAdapter[] {
    return [...this.adapters];
  }

  getByName(name: string): SourceAdapter | undefined {
    return this.adapters.find((a) => a.adapterName === name);
  }

  getByMarketplace(marketplace: string): SourceAdapter | undefined {
    return this.adapters.find((a) =>
      'marketplace' in a && (a as { marketplace?: string }).marketplace === marketplace
    );
  }

  getActive(): SourceAdapter[] {
    return this.adapters.filter((a) => a.isActive);
  }

  /**
   * Phase 19.3: Return adapters that have production-eligible provenance
   * (REAL_OFFICIAL_API, REAL_PUBLIC_WEB, REAL_PUBLIC_ENDPOINT).
   */
  getProductionEligible(): SourceAdapter[] {
    return this.adapters.filter((a) => {
      const ms = a as MarketplaceSource;
      return ms.dataProvenance !== undefined && isProductionEligibleProvenance(ms.dataProvenance);
    });
  }

  /**
   * Phase 19.3: Return the provenance category for an adapter, or undefined.
   */
  getProvenance(adapterName: string): DataProvenanceCategory | undefined {
    const adapter = this.getByName(adapterName) as MarketplaceSource | undefined;
    return adapter?.dataProvenance;
  }

  async shutdownAll(): Promise<void> {
    logger.info('All adapters shut down.');
  }
}

export const adapterRegistry = new MarketplaceAdapterRegistry();

export function registerDefaults(): void {
  adapterRegistry.register(new ShopeeAdapter());
  // Phase 30: Tokopedia browser adapter replaces HTTP adapter (SPA, server-side returns no data)
  adapterRegistry.register(new TokopediaBrowserAdapter());
  // Phase 25: Lazada browser-rendered adapter replaces the HTTP-based adapter.
  // Lazada's search page is a JS-rendered SPA — server-side HTTP returns no product data.
  // The browser adapter uses CDP to render the page and extract product cards.
  adapterRegistry.register(new LazadaBrowserAdapter());
  adapterRegistry.register(new BlibliAdapter());
  adapterRegistry.register(new TikTokShopAdapter());
  logger.info(`Registered ${adapterRegistry.getAll().length} marketplace adapters`);
}
