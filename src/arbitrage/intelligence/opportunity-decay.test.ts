import { computeOpportunityDecay } from './opportunity-decay';

describe('Opportunity Decay — half-life (IDEA §31)', () => {
  const baseInput = {
    discoveredAt: '2026-01-01T00:00:00Z',
    lastPriceObservedAt: '2026-01-01T00:00:00Z',
    lastSupplierVerifiedAt: '2026-01-01T00:00:00Z',
    now: '2026-01-01T12:00:00Z', // 12 hours later
    halfLifeHours: 24,
    priceChangeVelocity: null,
    supplierPriceChangeVelocity: null,
    competitionChangeVelocity: null,
    marketPriceTtlHours: 4,
    supplierPriceTtlHours: 72,
  };

  it('computes decay factor = 0.5^(age/halfLife)', () => {
    const result = computeOpportunityDecay(baseInput);
    // age=12h, halfLife=24h → 0.5^(12/24) = 0.5^0.5 = ~0.7071
    expect(result.decayFactor).not.toBeNull();
    expect(result.decayFactor).toBeCloseTo(0.7071, 2);
    expect(result.opportunityAgeHours).toBeCloseTo(12, 1);
  });

  it('returns FRESH for young opportunities', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      now: '2026-01-01T02:00:00Z', // 2h later, halfLife/4 = 6h
      lastPriceObservedAt: '2026-01-01T02:00:00Z',
    });
    expect(result.freshness).toBe('FRESH');
  });

  it('returns EXPIRED for very old opportunities', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      now: '2026-01-10T00:00:00Z', // 9 days later, halfLife*2 = 48h
      lastPriceObservedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.freshness).toBe('EXPIRED');
  });

  it('flags staleCriticalData when market price exceeds TTL', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      now: '2026-01-01T10:00:00Z', // 10h later, TTL=4h → stale
      lastPriceObservedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.staleCriticalData).toBe(true);
  });

  it('does NOT flag stale when price is within TTL', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      now: '2026-01-01T02:00:00Z', // 2h later, TTL=4h → fresh
      lastPriceObservedAt: '2026-01-01T02:00:00Z',
    });
    expect(result.staleCriticalData).toBe(false);
  });

  it('flags stale when price observation timestamp missing', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      lastPriceObservedAt: null,
    });
    expect(result.staleCriticalData).toBe(true);
  });

  it('opportunity_valid_now = false when staleCriticalData', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      now: '2026-01-01T10:00:00Z',
      lastPriceObservedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.opportunityValidNow).toBe(false);
  });

  it('returns UNKNOWN when discoveredAt is missing', () => {
    const result = computeOpportunityDecay({
      ...baseInput,
      discoveredAt: null,
    });
    expect(result.opportunityAgeHours).toBeNull();
    expect(result.decayFactor).toBeNull();
    expect(result.opportunityValidNow).toBeNull();
    expect(result.freshness).toBe('UNKNOWN');
  });

  it('computes estimated expiry', () => {
    const result = computeOpportunityDecay(baseInput);
    expect(result.estimatedExpiryHours).not.toBeNull();
    expect(result.estimatedExpiryHours).toBeGreaterThan(0);
  });
});
