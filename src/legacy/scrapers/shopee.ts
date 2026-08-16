import { UserPreferences, Marketplace } from '../models';
import { BaseScraper, Promo, defaultContext } from './base';

export class ShopeeScraper extends BaseScraper {
  marketplace = Marketplace.SHOPEE;

  async search(_prefs: UserPreferences, _ctx = defaultContext, _rp0Mode = false): Promise<Promo[]> {
    return [];
  }
}
