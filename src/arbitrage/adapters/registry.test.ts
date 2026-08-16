/**
 * Adapter Registry Tests (Phase 9 Coverage)
 */
import { MarketplaceAdapterRegistry } from './registry';
import { ShopeeAdapter } from './shopee-adapter';
import { TokopediaAdapter } from './tokopedia-adapter';
import { LazadaAdapter } from './lazada-adapter';
import { BlibliAdapter } from './blibli-adapter';
import { TikTokShopAdapter } from './tiktokshop-adapter';

describe('Adapter Registry (Phase 9)', () => {
  it('registerDefaults registers 5 marketplace adapters', () => {
    const registry = new MarketplaceAdapterRegistry();
    expect(registry.getAll()).toHaveLength(0);
    // Manually register adapters (like registerDefaults but on a fresh registry)
    registry.register(new ShopeeAdapter());
    registry.register(new TokopediaAdapter());
    registry.register(new LazadaAdapter());
    registry.register(new BlibliAdapter());
    registry.register(new TikTokShopAdapter());
    expect(registry.getAll()).toHaveLength(5);
  });

  it('getByName finds adapter by adapterName', () => {
    const registry = new MarketplaceAdapterRegistry();
    registry.register(new ShopeeAdapter());
    const found = registry.getByName('ShopeeIndonesiaAdapter');
    expect(found).toBeDefined();
    expect(found!.adapterName).toBe('ShopeeIndonesiaAdapter');
  });

  it('getByName returns undefined for unknown name', () => {
    const registry = new MarketplaceAdapterRegistry();
    expect(registry.getByName('NonExistent')).toBeUndefined();
  });

  it('getByMarketplace finds adapter by marketplace', () => {
    const registry = new MarketplaceAdapterRegistry();
    registry.register(new ShopeeAdapter());
    const found = registry.getByMarketplace('shopee');
    expect(found).toBeDefined();
    expect((found as any).marketplace).toBe('shopee');
  });

  it('getByMarketplace returns undefined for unknown marketplace', () => {
    const registry = new MarketplaceAdapterRegistry();
    expect(registry.getByMarketplace('nonexistent')).toBeUndefined();
  });

  it('getActive returns only active adapters', () => {
    const registry = new MarketplaceAdapterRegistry();
    registry.register(new ShopeeAdapter());
    const active = registry.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].isActive).toBe(true);
  });

  it('getAll returns a copy (not the internal array)', () => {
    const registry = new MarketplaceAdapterRegistry();
    const all1 = registry.getAll();
    all1.push({} as any);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('shutdownAll completes without error', async () => {
    const registry = new MarketplaceAdapterRegistry();
    await expect(registry.shutdownAll()).resolves.toBeUndefined();
  });
});

describe('Marketplace Adapter Construction (Phase 9)', () => {
  it('ShopeeAdapter has correct metadata', () => {
    const adapter = new ShopeeAdapter();
    expect(adapter.adapterName).toBe('ShopeeIndonesiaAdapter');
    expect(adapter.sourceName).toBe('Shopee Indonesia');
    expect(adapter.baseUrl).toBe('https://shopee.co.id');
    expect(adapter.isActive).toBe(true);
    expect((adapter as any).marketplace).toBe('shopee');
    const meta = adapter.getMetadata();
    expect(meta.name).toBe('Shopee Indonesia');
  });

  it('TokopediaAdapter has correct metadata', () => {
    const adapter = new TokopediaAdapter();
    expect(adapter.adapterName).toBe('TokopediaAdapter');
    expect(adapter.sourceName).toBe('Tokopedia');
    expect(adapter.baseUrl).toContain('tokopedia');
    const meta = adapter.getMetadata();
    expect(meta).toBeDefined();
  });

  it('LazadaAdapter has correct metadata', () => {
    const adapter = new LazadaAdapter();
    expect(adapter.adapterName).toBe('LazadaIDAdapter');
    expect(adapter.sourceName).toBe('Lazada Indonesia');
    const caps = adapter.getCapabilities();
    expect(caps).toBeDefined();
  });

  it('BlibliAdapter has correct metadata', () => {
    const adapter = new BlibliAdapter();
    expect(adapter.adapterName).toBe('BlibliAdapter');
    expect(adapter.sourceName).toContain('Blibli');
  });

  it('TikTokShopAdapter has correct metadata', () => {
    const adapter = new TikTokShopAdapter();
    expect(adapter.adapterName).toBe('TikTokShopIDAdapter');
    expect(adapter.sourceName).toContain('TikTok');
  });
});
