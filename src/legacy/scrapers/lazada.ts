import { UserPreferences, Marketplace } from '../models';
import { BaseScraper, Promo, defaultContext } from './base';

export class LazadaScraper extends BaseScraper {
  marketplace = Marketplace.LAZADA;

  async search(_prefs: UserPreferences, _ctx = defaultContext, _rp0Mode = false): Promise<Promo[]> {
    return [];
  }
}
