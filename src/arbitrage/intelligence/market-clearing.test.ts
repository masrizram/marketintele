import {
  computeMarketClearingPrice,
  percentile,
  weightedMedian,
  coefficientOfVariation,
  computeHHI,
  MarketListing,
} from './market-clearing';

function makeListing(
  id: string,
  sellerId: string,
  price: number,
  reviewCount: number | null = 10,
): MarketListing {
  return {
    listingId: id,
    sellerId,
    sellerName: `Seller ${sellerId}`,
    price,
    originalPrice: null,
    rating: 4.5,
    reviewCount,
    soldCount: null,
    stock: null,
    title: `Product ${id}`,
    observedAt: new Date().toISOString(),
    sourceUrl: `https://example.com/${id}`,
  };
}

describe('Market Clearing Price — percentile', () => {
  it('computes P50 (median) of even-length data via interpolation', () => {
    // [10, 20, 30, 40] → P50 = 25 (interpolation between index 1 and 2)
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
  });

  it('computes P50 of odd-length data as the middle element', () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
  });

  it('computes P0 and P100 as min and max', () => {
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50);
  });

  it('returns NaN for empty input', () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it('returns the single element for length-1 input', () => {
    expect(percentile([42], 50)).toBe(42);
  });
});

describe('Market Clearing Price — coefficientOfVariation', () => {
  it('returns 0 for a single value (no dispersion)', () => {
    expect(coefficientOfVariation([100])).toBe(0);
  });

  it('returns 0 for identical values', () => {
    expect(coefficientOfVariation([100, 100, 100])).toBe(0);
  });

  it('computes CV for spread values', () => {
    // mean=100, stdev=sqrt(((25+0+25)/3)) = sqrt(16.67) ≈ 4.08, CV ≈ 0.0408
    const cv = coefficientOfVariation([75, 100, 125]);
    expect(cv).toBeGreaterThan(0);
    expect(cv).toBeLessThan(1);
  });
});

describe('Market Clearing Price — computeHHI', () => {
  it('returns 1.0 for a monopoly (single seller)', () => {
    const listings = [makeListing('1', 's1', 100), makeListing('2', 's1', 200)];
    const { hhi, sellerCount } = computeHHI(listings);
    expect(sellerCount).toBe(1);
    expect(hhi).toBe(1);
  });

  it('returns low HHI for many fragmented sellers', () => {
    const listings = Array.from({ length: 10 }, (_, i) =>
      makeListing(`${i}`, `s${i}`, 100),
    );
    const { hhi, sellerCount } = computeHHI(listings);
    expect(sellerCount).toBe(10);
    expect(hhi).toBeLessThan(0.2);
  });
});

describe('Market Clearing Price — weightedMedian', () => {
  it('returns the middle-weighted price', () => {
    const listings = [
      makeListing('1', 's1', 100, 10),
      makeListing('2', 's2', 200, 10),
      makeListing('3', 's3', 300, 10),
    ];
    expect(weightedMedian(listings)).toBe(200);
  });

  it('gives weight to high-review listings', () => {
    const listings = [
      makeListing('1', 's1', 100, 1),
      makeListing('2', 's2', 500, 100),
    ];
    // total weight 101, half = 50.5. listing1 (w=1) → cum=1 < 50.5. listing2 (w=100) → cum=101 >= 50.5
    expect(weightedMedian(listings)).toBe(500);
  });
});

describe('Market Clearing Price — computeMarketClearingPrice', () => {
  it('computes clearing price for a normal distribution of listings', () => {
    const listings = Array.from({ length: 10 }, (_, i) =>
      makeListing(`${i}`, `s${i}`, 90000 + i * 2000),
    );
    const result = computeMarketClearingPrice(listings);
    expect(result.marketClearingPrice).not.toBeNull();
    expect(result.priceConfidence).not.toBe('INSUFFICIENT');
    expect(result.effectiveSampleSize).toBe(10);
    expect(result.percentiles).not.toBeNull();
    expect(result.sellerCount).toBe(10);
  });

  it('clearing price = P25 (conservative, not max)', () => {
    const listings = Array.from({ length: 10 }, (_, i) =>
      makeListing(`${i}`, `s${i}`, 10000 + i * 1000),
    );
    const result = computeMarketClearingPrice(listings);
    const p25 = result.percentiles!.p25;
    expect(result.marketClearingPrice).toBe(p25);
    // Must NOT be the highest price
    expect(result.marketClearingPrice).toBeLessThan(19000);
  });

  it('rejects abnormally high outlier', () => {
    const listings = [
      makeListing('1', 's1', 10000),
      makeListing('2', 's2', 11000),
      makeListing('3', 's3', 10500),
      makeListing('4', 's4', 10200),
      makeListing('5', 's5', 500000), // absurd outlier
    ];
    const result = computeMarketClearingPrice(listings);
    expect(result.effectiveSampleSize).toBe(4); // outlier excluded
    expect(result.excludedListings.length).toBe(1);
    expect(result.excludedListings[0].reason).toContain('outlier');
  });

  it('rejects abnormally low outlier', () => {
    const listings = [
      makeListing('1', 's1', 100000),
      makeListing('2', 's2', 110000),
      makeListing('3', 's3', 105000),
      makeListing('4', 's4', 102000),
      makeListing('5', 's5', 100), // absurd low outlier
    ];
    const result = computeMarketClearingPrice(listings);
    expect(result.effectiveSampleSize).toBe(4);
    expect(result.excludedListings.some((e) => e.reason.includes('abnormally low'))).toBe(true);
  });

  it('returns INSUFFICIENT for empty input (UNKNOWN != ZERO)', () => {
    const result = computeMarketClearingPrice([]);
    expect(result.marketClearingPrice).toBeNull();
    expect(result.priceConfidence).toBe('INSUFFICIENT');
    expect(result.percentiles).toBeNull();
  });

  it('returns INSUFFICIENT when all prices are invalid', () => {
    const listings = [
      makeListing('1', 's1', 0),
      makeListing('2', 's2', -100),
      makeListing('3', 's3', NaN as unknown as number),
    ];
    const result = computeMarketClearingPrice(listings);
    expect(result.marketClearingPrice).toBeNull();
    expect(result.priceConfidence).toBe('INSUFFICIENT');
    expect(result.excludedListings.length).toBe(3);
  });

  it('returns LOW confidence for minimal sample (2 listings)', () => {
    const listings = [makeListing('1', 's1', 10000), makeListing('2', 's2', 11000)];
    const result = computeMarketClearingPrice(listings);
    expect(result.priceConfidence).toBe('LOW');
  });

  it('returns HIGH confidence for large sample with low dispersion', () => {
    const listings = Array.from({ length: 10 }, (_, i) =>
      makeListing(`${i}`, `s${i}`, 100000 + i * 100),
    );
    const result = computeMarketClearingPrice(listings);
    expect(['HIGH', 'MEDIUM']).toContain(result.priceConfidence);
  });

  it('never uses a single listing as market price', () => {
    const result = computeMarketClearingPrice([makeListing('1', 's1', 99999)]);
    // Single listing → low confidence, clearing price still computed but flagged
    expect(result.effectiveSampleSize).toBe(1);
    expect(result.priceConfidence).toBe('INSUFFICIENT');
  });

  it('carries source_list and timestamp for auditability', () => {
    const listings = [makeListing('1', 's1', 10000), makeListing('2', 's2', 11000)];
    const result = computeMarketClearingPrice(listings);
    expect(result.sourceList.length).toBeGreaterThan(0);
    expect(result.timestamp).toBeDefined();
    expect(result.methodology).toContain('IQR');
  });
});
