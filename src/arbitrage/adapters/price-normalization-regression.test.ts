/**
 * Price normalization regression tests.
 *
 * Guards against the discovery-pipeline TypeError where a numeric price is
 * passed back into a string-only parser, plus the full price-type contract:
 *   string / number / null / undefined / malformed / NaN / Infinity / currency.
 *
 * Every affected adapter must:
 *   - never throw a TypeError on any of these inputs
 *   - yield a finite number for valid prices
 *   - yield null for invalid prices
 */
import { LazadaBrowserAdapter } from './lazada-browser-adapter';
import { TokopediaBrowserAdapter } from './tokopedia-browser-adapter';
import { ShopeeAdapter } from './shopee-adapter';
import { LazadaAdapter } from './lazada-adapter';
import { TokopediaAdapter } from './tokopedia-adapter';
import { BlibliAdapter } from './blibli-adapter';
import { TikTokShopAdapter } from './tiktokshop-adapter';
import { ParsedEntity } from '../types';

function makeEntity(price: unknown): ParsedEntity {
  return {
    rawDocumentId: 'raw-1',
    sourceId: 'src-1',
    extractedAt: new Date().toISOString(),
    title: 'Test Product',
    brand: null,
    model: null,
    sku: null,
    barcode: null,
    category: null,
    price: price as number | null,
    currency: 'IDR',
    moq: 1,
    packageQuantity: 1,
    packageUnit: 'pcs',
    supplierName: null,
    supplierType: 'RESELLER',
    marketplace: 'test',
    sellerId: null,
    sellerName: null,
    rating: null,
    reviewCount: null,
    soldCount: null,
    rawEvidence: {},
    extractionConfidence: 0.8,
  };
}

describe('Browser adapters — parsePrice contract', () => {
  const lazada = (new LazadaBrowserAdapter() as any).parsePrice.bind(new LazadaBrowserAdapter());
  const tokopedia = (new TokopediaBrowserAdapter() as any).parsePrice.bind(new TokopediaBrowserAdapter());

  const cases: Array<[string, unknown, number | null]> = [
    ['string price', '18990', 18990],
    ['currency-formatted "Rp18.990"', 'Rp18.990', 18990],
    ['currency-formatted "Rp120.000"', 'Rp120.000', 120000],
    ['numeric price', 18990, 18990],
    ['numeric price 0', 0, 0],
    ['null price', null, null],
    ['undefined price', undefined, null],
    ['malformed string', 'no price', null],
    ['empty string', '', null],
    ['NaN', NaN, null],
    ['Infinity', Infinity, null],
    ['-Infinity', -Infinity, null],
  ];

  for (const [name, input, expected] of cases) {
    it(`lazada parsePrice: ${name}`, () => {
      expect(lazada(input)).toBe(expected);
    });
    it(`tokopedia parsePrice: ${name}`, () => {
      expect(tokopedia(input)).toBe(expected);
    });
  }

  it('lazada parsePrice never throws on arbitrary input', () => {
    expect(() => lazada({})).not.toThrow();
    expect(() => lazada(true)).not.toThrow();
  });

  it('tokopedia parsePrice never throws on arbitrary input', () => {
    expect(() => tokopedia({})).not.toThrow();
    expect(() => tokopedia(true)).not.toThrow();
  });
});

describe('Browser adapters — normalize does not double-parse numeric price', () => {
  it('lazada normalize accepts a numeric price (no TypeError)', async () => {
    const adapter = new LazadaBrowserAdapter();
    const raw: any = { title: 'Mouse', price: 18990, url: 'https://www.lazada.co.id/products/pdp-i123.html' };
    const result = await adapter.normalize(raw as any);
    expect(result.priceInIdr).toBe(18990);
  });

  it('lazada normalize accepts a currency-formatted string price', async () => {
    const adapter = new LazadaBrowserAdapter();
    const raw: any = { title: 'Mouse', price: 'Rp18.990', url: 'https://www.lazada.co.id/products/pdp-i123.html' };
    const result = await adapter.normalize(raw as any);
    expect(result.priceInIdr).toBe(18990);
  });

  it('lazada normalize maps invalid prices to null', async () => {
    const adapter = new LazadaBrowserAdapter();
    for (const price of [null, undefined, 'no price', '', NaN, Infinity, -Infinity]) {
      const raw: any = { title: 'Mouse', price, url: 'https://www.lazada.co.id/products/pdp-i123.html' };
      const result = await adapter.normalize(raw as any);
      expect(result.priceInIdr).toBeNull();
    }
  });

  it('tokopedia normalize accepts a numeric price (no TypeError)', async () => {
    const adapter = new TokopediaBrowserAdapter();
    const raw: any = { title: 'Mouse', price: 18990, url: 'https://www.tokopedia.com/x/p/123' };
    const result = await adapter.normalize(raw as any);
    expect(result.priceInIdr).toBe(18990);
  });

  it('tokopedia normalize accepts a currency-formatted string price', async () => {
    const adapter = new TokopediaBrowserAdapter();
    const raw: any = { title: 'Mouse', price: 'Rp18.990', url: 'https://www.tokopedia.com/x/p/123' };
    const result = await adapter.normalize(raw as any);
    expect(result.priceInIdr).toBe(18990);
  });

  it('tokopedia normalize maps invalid prices to null', async () => {
    const adapter = new TokopediaBrowserAdapter();
    for (const price of [null, undefined, 'no price', '', NaN, Infinity, -Infinity]) {
      const raw: any = { title: 'Mouse', price, url: 'https://www.tokopedia.com/x/p/123' };
      const result = await adapter.normalize(raw as any);
      expect(result.priceInIdr).toBeNull();
    }
  });
});

describe('HTTP adapters — normalize rejects non-finite prices', () => {
  const adapters: Array<[string, { normalize(e: ParsedEntity): Promise<{ priceInIdr: number | null }> }]> = [
    ['ShopeeAdapter', new ShopeeAdapter() as any],
    ['LazadaAdapter', new LazadaAdapter() as any],
    ['TokopediaAdapter', new TokopediaAdapter() as any],
    ['BlibliAdapter', new BlibliAdapter() as any],
    ['TikTokShopAdapter', new TikTokShopAdapter() as any],
  ];

  for (const [name, adapter] of adapters) {
    it(`${name}: finite price passes through`, async () => {
      const result = await adapter.normalize(makeEntity(18990));
      expect(result.priceInIdr).toBe(18990);
    });

    it(`${name}: null price stays null`, async () => {
      const result = await adapter.normalize(makeEntity(null));
      expect(result.priceInIdr).toBeNull();
    });

    it(`${name}: NaN price becomes null`, async () => {
      const result = await adapter.normalize(makeEntity(NaN));
      expect(result.priceInIdr).toBeNull();
    });

    it(`${name}: Infinity price becomes null`, async () => {
      const result = await adapter.normalize(makeEntity(Infinity));
      expect(result.priceInIdr).toBeNull();
    });

    it(`${name}: -Infinity price becomes null`, async () => {
      const result = await adapter.normalize(makeEntity(-Infinity));
      expect(result.priceInIdr).toBeNull();
    });
  }
});
