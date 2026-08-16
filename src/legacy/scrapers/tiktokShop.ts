import { UserPreferences, Marketplace } from '../models';
import { BaseScraper, Promo, defaultContext } from './base';

export class TikTokShopScraper extends BaseScraper {
  marketplace = Marketplace.TIKTOK_SHOP;

  async search(_prefs: UserPreferences, _ctx = defaultContext, _rp0Mode = false): Promise<Promo[]> {
    return [];
  }
}
