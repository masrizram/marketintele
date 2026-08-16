import { UserPreferences } from '../models';
import { BaseScraper, Promo, ScraperContext } from './base';
import { ShopeeScraper } from './shopee';
import { TokopediaScraper } from './tokopedia';
import { LazadaScraper } from './lazada';
import { BlibliScraper } from './blibli';
import { TikTokShopScraper } from './tiktokShop';

const SCRAPERS: BaseScraper[] = [
  new ShopeeScraper(),
  new TokopediaScraper(),
  new LazadaScraper(),
  new BlibliScraper(),
  new TikTokShopScraper(),
];

export async function searchPromos(prefs: UserPreferences, ctx: ScraperContext, rp0Mode = false): Promise<Promo[]> {
  const results: Promo[] = [];
  for (const scraper of SCRAPERS) {
    if (prefs.marketplaces.length && !prefs.marketplaces.includes(scraper.marketplace)) {
      continue;
    }
    try {
      const promos = await scraper.search(prefs, ctx, rp0Mode);
      results.push(...promos);
    } catch (err) {
      console.error(`Scraper ${scraper.marketplace} failed:`, err);
    }
  }
  return results;
}
