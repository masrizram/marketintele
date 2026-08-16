import { assessDemand } from './demand';

describe('Demand Engine — signal classification (IDEA §18)', () => {
  it('classifies sold_count and review_count as OBSERVED', () => {
    const result = assessDemand({
      soldCount: 500,
      reviewCount: 200,
      reviewVelocity: null,
      ranking: null,
      listingGrowth: null,
      sellerCount: null,
      historicalPriceObservations: [],
      observedAt: new Date().toISOString(),
    });
    const observed = result.signals.filter((s) => s.provenance === 'OBSERVED');
    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(result.demandScore).not.toBeNull();
    expect(result.demandClass).not.toBe('UNKNOWN');
  });

  it('classifies ranking and listing_growth as HEURISTIC', () => {
    const result = assessDemand({
      soldCount: null,
      reviewCount: null,
      reviewVelocity: null,
      ranking: 5,
      listingGrowth: 10,
      sellerCount: 3,
      historicalPriceObservations: [],
      observedAt: new Date().toISOString(),
    });
    const heuristics = result.signals.filter((s) => s.provenance === 'HEURISTIC');
    expect(heuristics.length).toBeGreaterThan(0);
    // With ONLY heuristic signals and no OBSERVED, demand should be UNKNOWN
    expect(result.demandScore).toBeNull();
    expect(result.demandClass).toBe('UNKNOWN');
  });

  it('NEVER presents heuristic as observed (provenance preserved)', () => {
    const result = assessDemand({
      soldCount: 100,
      reviewCount: 50,
      reviewVelocity: null,
      ranking: 1,
      listingGrowth: 5,
      sellerCount: 10,
      historicalPriceObservations: [],
      observedAt: new Date().toISOString(),
    });
    const rankingSignal = result.signals.find((s) => s.name === 'ranking');
    expect(rankingSignal?.provenance).toBe('HEURISTIC');
    const soldSignal = result.signals.find((s) => s.name === 'sold_count');
    expect(soldSignal?.provenance).toBe('OBSERVED');
  });
});

describe('Demand Engine — UNKNOWN != ZERO', () => {
  it('returns UNKNOWN demand when all signals missing', () => {
    const result = assessDemand({
      soldCount: null,
      reviewCount: null,
      reviewVelocity: null,
      ranking: null,
      listingGrowth: null,
      sellerCount: null,
      historicalPriceObservations: [],
      observedAt: new Date().toISOString(),
    });
    expect(result.demandScore).toBeNull();
    expect(result.demandClass).toBe('UNKNOWN');
    expect(result.demandConfidence).toBe(0);
  });

  it('does not inflate missing demand to HIGH', () => {
    const result = assessDemand({
      soldCount: null,
      reviewCount: 5,
      reviewVelocity: null,
      ranking: null,
      listingGrowth: null,
      sellerCount: null,
      historicalPriceObservations: [],
      observedAt: new Date().toISOString(),
    });
    // Only review_count=5 (low) → should not be HIGH
    expect(result.demandClass).not.toBe('HIGH');
  });
});

describe('Demand Engine — demand classes', () => {
  it('returns HIGH for strong observed signals', () => {
    const result = assessDemand({
      soldCount: 2000,
      reviewCount: 1000,
      reviewVelocity: 10,
      ranking: 1,
      listingGrowth: 20,
      sellerCount: 15,
      historicalPriceObservations: [],
      observedAt: new Date().toISOString(),
    });
    expect(result.demandScore).not.toBeNull();
    expect(result.demandScore).toBeGreaterThan(0.5);
  });

  it('returns trend from historical observations', () => {
    const result = assessDemand({
      soldCount: 100,
      reviewCount: 50,
      reviewVelocity: null,
      ranking: null,
      listingGrowth: null,
      sellerCount: null,
      historicalPriceObservations: [100000, 105000, 110000], // rising
      observedAt: new Date().toISOString(),
    });
    expect(result.demandTrend).toBe('RISING');
  });

  it('returns UNKNOWN trend for insufficient history', () => {
    const result = assessDemand({
      soldCount: 100,
      reviewCount: 50,
      reviewVelocity: null,
      ranking: null,
      listingGrowth: null,
      sellerCount: null,
      historicalPriceObservations: [100000], // only 1 point
      observedAt: new Date().toISOString(),
    });
    expect(result.demandTrend).toBe('UNKNOWN');
  });
});
