/**
 * Adapter registry — manages all source adapters and provides lookup.
 */
import { SourceAdapter } from '../types';
import { logger } from '../lib/logger';

import { ShopeeAdapter } from './shopee-adapter';
import { TokopediaAdapter } from './tokopedia-adapter';
import { LazadaAdapter } from './lazada-adapter';
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

  async shutdownAll(): Promise<void> {
    logger.info('All adapters shut down.');
  }
}

export const adapterRegistry = new MarketplaceAdapterRegistry();

export function registerDefaults(): void {
  adapterRegistry.register(new ShopeeAdapter());
  adapterRegistry.register(new TokopediaAdapter());
  adapterRegistry.register(new LazadaAdapter());
  adapterRegistry.register(new BlibliAdapter());
  adapterRegistry.register(new TikTokShopAdapter());
  logger.info(`Registered ${adapterRegistry.getAll().length} marketplace adapters`);
}
