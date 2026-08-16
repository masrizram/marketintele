import { assessCompetition } from './competition';
import { MarketListing } from './market-clearing';

function makeListing(id: string, sellerId: string, price: number, reviewCount: number | null = 10): MarketListing {
  return {
    listingId: id, sellerId, sellerName: `Seller ${sellerId}`, price,
    originalPrice: null, rating: 4.5, reviewCount, soldCount: null, stock: null,
    title: `Product ${id}`, observedAt: new Date().toISOString(), sourceUrl: `https://example.com/${id}`,
  };
}

describe('Competition Engine — core metrics (IDEA §19)', () => {
  it('computes seller_count and HHI', () => {
    const result = assessCompetition({
      listings: [makeListing('1', 's1', 10000), makeListing('2', 's2', 11000), makeListing('3', 's3', 10500)],
      priceChangeFrequency: null,
      recentUndercutCount: null,
      observedAt: new Date().toISOString(),
    });
    expect(result.sellerCount).toBe(3);
    expect(result.sellerConcentration).not.toBeNull();
    expect(result.sellerConcentration).toBeLessThan(0.5); // fragmented
  });

  it('detects monopoly (single seller = HHI=1)', () => {
    const result = assessCompetition({
      listings: [makeListing('1', 's1', 10000), makeListing('2', 's1', 11000)],
      priceChangeFrequency: null,
      recentUndercutCount: null,
      observedAt: new Date().toISOString(),
    });
    expect(result.sellerCount).toBe(1);
    expect(result.sellerConcentration).toBe(1);
  });

  it('returns UNKNOWN for empty listings', () => {
    const result = assessCompetition({
      listings: [],
      priceChangeFrequency: null,
      recentUndercutCount: null,
      observedAt: new Date().toISOString(),
    });
    expect(result.competitionScore).toBeNull();
    expect(result.competitionLevel).toBe('UNKNOWN');
    expect(result.priceWarRisk).toBe('UNKNOWN');
  });

  it('detects price-war risk from undercutting', () => {
    const result = assessCompetition({
      listings: Array.from({ length: 12 }, (_, i) => makeListing(`${i}`, `s${i}`, 10000 + i * 100)),
      priceChangeFrequency: 5,
      recentUndercutCount: 4,
      observedAt: new Date().toISOString(),
    });
    expect(result.priceWarProbability).not.toBeNull();
    expect(result.priceWarProbability).toBeGreaterThan(0.3);
  });

  it('computes lowest_price', () => {
    const result = assessCompetition({
      listings: [makeListing('1', 's1', 15000), makeListing('2', 's2', 10000), makeListing('3', 's3', 12000)],
      priceChangeFrequency: null,
      recentUndercutCount: null,
      observedAt: new Date().toISOString(),
    });
    expect(result.lowestPrice).toBe(10000);
  });

  it('computes market_saturation_score (HIGH_DEMAND != GOOD)', () => {
    const result = assessCompetition({
      listings: Array.from({ length: 20 }, (_, i) => makeListing(`${i}`, `s${i}`, 10000 + i * 50)),
      priceChangeFrequency: null,
      recentUndercutCount: null,
      observedAt: new Date().toISOString(),
    });
    expect(result.marketSaturationScore).not.toBeNull();
    // Many sellers with compressed prices = high saturation
    expect(result.marketSaturationScore).toBeGreaterThan(0.3);
  });
});
