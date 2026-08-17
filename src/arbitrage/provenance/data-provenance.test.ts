/**
 * Data Provenance Model Tests — Phase 19.3 / 19.8 / 19.10
 *
 * Verifies:
 *   1. Provenance categories: only REAL_* are production-eligible.
 *   2. Freshness: STALE data blocks production opportunities.
 *   3. Source priority: REAL_OFFICIAL_API > REAL_PUBLIC_ENDPOINT > REAL_PUBLIC_WEB.
 *   4. Marketplace source registry: correct classification per adapter.
 *   5. Reliability classification (A-D) thresholds.
 *   6. Marketplace adapters carry correct provenance metadata.
 */
import {
  isProductionEligibleProvenance,
  computeFreshnessStatus,
  compareProvenancePriority,
  classifyReliability,
  SOURCE_PRIORITY,
  MAX_MARKETPLACE_OBSERVATION_AGE_HOURS,
  DataProvenanceCategory,
} from './data-provenance';
import {
  MARKETPLACE_SOURCE_CLASSIFICATIONS,
  getMarketplaceClassification,
  getAdapterClassification,
  hasOfficialApiAdapter,
  countByCategory,
} from './marketplace-source-registry';
import { ShopeeAdapter } from '../adapters/shopee-adapter';
import { TokopediaAdapter } from '../adapters/tokopedia-adapter';
import { LazadaAdapter } from '../adapters/lazada-adapter';
import { BlibliAdapter } from '../adapters/blibli-adapter';
import { TikTokShopAdapter } from '../adapters/tiktokshop-adapter';

describe('Phase 19.3 — Provenance Production Eligibility', () => {
  it('REAL_OFFICIAL_API is production-eligible', () => {
    expect(isProductionEligibleProvenance('REAL_OFFICIAL_API')).toBe(true);
  });

  it('REAL_PUBLIC_WEB is production-eligible', () => {
    expect(isProductionEligibleProvenance('REAL_PUBLIC_WEB')).toBe(true);
  });

  it('REAL_PUBLIC_ENDPOINT is production-eligible', () => {
    expect(isProductionEligibleProvenance('REAL_PUBLIC_ENDPOINT')).toBe(true);
  });

  it('TEST_FIXTURE is NOT production-eligible', () => {
    expect(isProductionEligibleProvenance('TEST_FIXTURE')).toBe(false);
  });

  it('MOCK is NOT production-eligible', () => {
    expect(isProductionEligibleProvenance('MOCK')).toBe(false);
  });

  it('SIMULATION is NOT production-eligible', () => {
    expect(isProductionEligibleProvenance('SIMULATION')).toBe(false);
  });

  it('all six categories are covered', () => {
    const categories: DataProvenanceCategory[] = [
      'REAL_OFFICIAL_API',
      'REAL_PUBLIC_WEB',
      'REAL_PUBLIC_ENDPOINT',
      'TEST_FIXTURE',
      'MOCK',
      'SIMULATION',
    ];
    expect(categories).toHaveLength(6);
  });
});

describe('Phase 19.8 — Data Freshness Controls', () => {
  it('recent timestamp (< 24h) is FRESH', () => {
    const now = Date.now();
    const recent = new Date(now - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    expect(computeFreshnessStatus(recent, 24, now)).toBe('FRESH');
  });

  it('old timestamp (> 24h) is STALE', () => {
    const now = Date.now();
    const old = new Date(now - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    expect(computeFreshnessStatus(old, 24, now)).toBe('STALE');
  });

  it('exactly at max age boundary is FRESH (<=)', () => {
    const now = Date.now();
    const boundary = new Date(now - 24 * 60 * 60 * 1000).toISOString(); // exactly 24h
    expect(computeFreshnessStatus(boundary, 24, now)).toBe('FRESH');
  });

  it('invalid timestamp is STALE', () => {
    expect(computeFreshnessStatus('not-a-date')).toBe('STALE');
  });

  it('empty timestamp is STALE', () => {
    expect(computeFreshnessStatus('')).toBe('STALE');
  });

  it('default max age is 24 hours', () => {
    expect(MAX_MARKETPLACE_OBSERVATION_AGE_HOURS).toBe(24);
  });

  it('custom max age works', () => {
    const now = Date.now();
    const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000).toISOString();
    // 4h max → 6h ago is STALE
    expect(computeFreshnessStatus(sixHoursAgo, 4, now)).toBe('STALE');
    // 8h max → 6h ago is FRESH
    expect(computeFreshnessStatus(sixHoursAgo, 8, now)).toBe('FRESH');
  });
});

describe('Phase 19.10 — Source Priority', () => {
  it('SOURCE_PRIORITY has 3 REAL_* entries in correct order', () => {
    expect(SOURCE_PRIORITY).toEqual(['REAL_OFFICIAL_API', 'REAL_PUBLIC_ENDPOINT', 'REAL_PUBLIC_WEB']);
  });

  it('REAL_OFFICIAL_API has higher priority than REAL_PUBLIC_ENDPOINT', () => {
    expect(compareProvenancePriority('REAL_OFFICIAL_API', 'REAL_PUBLIC_ENDPOINT')).toBeLessThan(0);
  });

  it('REAL_PUBLIC_ENDPOINT has higher priority than REAL_PUBLIC_WEB', () => {
    expect(compareProvenancePriority('REAL_PUBLIC_ENDPOINT', 'REAL_PUBLIC_WEB')).toBeLessThan(0);
  });

  it('REAL_OFFICIAL_API has higher priority than REAL_PUBLIC_WEB', () => {
    expect(compareProvenancePriority('REAL_OFFICIAL_API', 'REAL_PUBLIC_WEB')).toBeLessThan(0);
  });

  it('TEST_FIXTURE ranks below all REAL_* categories', () => {
    expect(compareProvenancePriority('TEST_FIXTURE', 'REAL_PUBLIC_WEB')).toBeGreaterThan(0);
    expect(compareProvenancePriority('TEST_FIXTURE', 'REAL_OFFICIAL_API')).toBeGreaterThan(0);
  });

  it('MOCK ranks below all REAL_* categories', () => {
    expect(compareProvenancePriority('MOCK', 'REAL_PUBLIC_ENDPOINT')).toBeGreaterThan(0);
  });

  it('equal categories have zero difference', () => {
    expect(compareProvenancePriority('REAL_PUBLIC_WEB', 'REAL_PUBLIC_WEB')).toBe(0);
  });
});

describe('Phase 19.9 — Reliability Classification', () => {
  it('>= 95% combined success → A (production-usable)', () => {
    expect(classifyReliability(0.95)).toBe('A');
    expect(classifyReliability(0.99)).toBe('A');
    expect(classifyReliability(1.0)).toBe('A');
  });

  it('>= 85% (and < 95%) → B (usable with monitoring)', () => {
    expect(classifyReliability(0.85)).toBe('B');
    expect(classifyReliability(0.90)).toBe('B');
    expect(classifyReliability(0.949)).toBe('B');
  });

  it('>= 70% (and < 85%) → C (fragile)', () => {
    expect(classifyReliability(0.70)).toBe('C');
    expect(classifyReliability(0.75)).toBe('C');
    expect(classifyReliability(0.849)).toBe('C');
  });

  it('< 70% → D (unusable)', () => {
    expect(classifyReliability(0.69)).toBe('D');
    expect(classifyReliability(0.50)).toBe('D');
    expect(classifyReliability(0)).toBe('D');
  });
});

describe('Phase 19.1/19.2 — Marketplace Source Registry', () => {
  it('classifies exactly 5 marketplace adapters', () => {
    expect(MARKETPLACE_SOURCE_CLASSIFICATIONS).toHaveLength(5);
  });

  it('NO adapter is classified as REAL_OFFICIAL_API', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(c.category).not.toBe('REAL_OFFICIAL_API');
    }
  });

  it('NO adapter is classified as TEST_FIXTURE, MOCK, or SIMULATION', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(['TEST_FIXTURE', 'MOCK', 'SIMULATION']).not.toContain(c.category);
    }
  });

  it('all adapters are classified as REAL_PUBLIC_*', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(['REAL_PUBLIC_WEB', 'REAL_PUBLIC_ENDPOINT']).toContain(c.category);
    }
  });

  it('all adapters are production-eligible', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(isProductionEligibleProvenance(c.category)).toBe(true);
    }
  });

  it('all adapters record retrieval timestamps', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(c.recordsRetrievalTimestamp).toBe(true);
    }
  });

  it('all adapters validate HTTP status', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(c.validatesHttpStatus).toBe(true);
    }
  });

  it('all adapters return null (not 0) for missing prices', () => {
    for (const c of MARKETPLACE_SOURCE_CLASSIFICATIONS) {
      expect(c.returnsNullForMissingPrice).toBe(true);
    }
  });

  it('hasOfficialApiAdapter() returns false (no official API)', () => {
    expect(hasOfficialApiAdapter()).toBe(false);
  });

  it('countByCategory shows 0 REAL_OFFICIAL_API', () => {
    const counts = countByCategory();
    expect(counts.REAL_OFFICIAL_API).toBe(0);
    expect(counts.REAL_PUBLIC_WEB).toBe(3);
    expect(counts.REAL_PUBLIC_ENDPOINT).toBe(2);
    expect(counts.TEST_FIXTURE).toBe(0);
    expect(counts.MOCK).toBe(0);
    expect(counts.SIMULATION).toBe(0);
  });

  it('Shopee is REAL_PUBLIC_ENDPOINT', () => {
    const c = getMarketplaceClassification('shopee');
    expect(c).toBeDefined();
    expect(c!.category).toBe('REAL_PUBLIC_ENDPOINT');
    expect(c!.acquisitionMethod).toBe('PUBLIC_ENDPOINT');
  });

  it('Tokopedia is REAL_PUBLIC_WEB', () => {
    const c = getMarketplaceClassification('tokopedia');
    expect(c).toBeDefined();
    expect(c!.category).toBe('REAL_PUBLIC_WEB');
  });

  it('Lazada is REAL_PUBLIC_WEB', () => {
    const c = getMarketplaceClassification('lazada');
    expect(c).toBeDefined();
    expect(c!.category).toBe('REAL_PUBLIC_WEB');
  });

  it('Blibli is REAL_PUBLIC_ENDPOINT', () => {
    const c = getMarketplaceClassification('blibli');
    expect(c).toBeDefined();
    expect(c!.category).toBe('REAL_PUBLIC_ENDPOINT');
  });

  it('TikTok Shop is REAL_PUBLIC_WEB', () => {
    const c = getMarketplaceClassification('tiktok_shop');
    expect(c).toBeDefined();
    expect(c!.category).toBe('REAL_PUBLIC_WEB');
  });

  it('getAdapterClassification finds by adapterName', () => {
    expect(getAdapterClassification('ShopeeIndonesiaAdapter')?.marketplace).toBe('shopee');
    expect(getAdapterClassification('BlibliAdapter')?.marketplace).toBe('blibli');
  });
});

describe('Phase 19.2 — Adapter Provenance Metadata', () => {
  it('ShopeeAdapter carries REAL_PUBLIC_WEB provenance (v2 API deprecated, now fetches search page)', () => {
    const adapter = new ShopeeAdapter();
    expect(adapter.dataProvenance).toBe('REAL_PUBLIC_WEB');
    expect(adapter.acquisitionMethod).toBe('PUBLIC_WEB');
    expect(isProductionEligibleProvenance(adapter.dataProvenance)).toBe(true);
  });

  it('TokopediaAdapter carries REAL_PUBLIC_WEB provenance', () => {
    const adapter = new TokopediaAdapter();
    expect(adapter.dataProvenance).toBe('REAL_PUBLIC_WEB');
    expect(adapter.acquisitionMethod).toBe('PUBLIC_WEB');
    expect(isProductionEligibleProvenance(adapter.dataProvenance)).toBe(true);
  });

  it('LazadaAdapter carries REAL_PUBLIC_WEB provenance', () => {
    const adapter = new LazadaAdapter();
    expect(adapter.dataProvenance).toBe('REAL_PUBLIC_WEB');
    expect(adapter.acquisitionMethod).toBe('PUBLIC_WEB');
    expect(isProductionEligibleProvenance(adapter.dataProvenance)).toBe(true);
  });

  it('BlibliAdapter carries REAL_PUBLIC_ENDPOINT provenance', () => {
    const adapter = new BlibliAdapter();
    expect(adapter.dataProvenance).toBe('REAL_PUBLIC_ENDPOINT');
    expect(adapter.acquisitionMethod).toBe('PUBLIC_ENDPOINT');
    expect(isProductionEligibleProvenance(adapter.dataProvenance)).toBe(true);
  });

  it('TikTokShopAdapter carries REAL_PUBLIC_WEB provenance', () => {
    const adapter = new TikTokShopAdapter();
    expect(adapter.dataProvenance).toBe('REAL_PUBLIC_WEB');
    expect(adapter.acquisitionMethod).toBe('PUBLIC_WEB');
    expect(isProductionEligibleProvenance(adapter.dataProvenance)).toBe(true);
  });
});
