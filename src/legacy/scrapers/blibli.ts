import { UserPreferences, Marketplace } from '../models';
import { BaseScraper, Promo, defaultContext } from './base';

export class BlibliScraper extends BaseScraper {
  marketplace = Marketplace.BLIBLI;

  async search(_prefs: UserPreferences, _ctx = defaultContext, _rp0Mode = false): Promise<Promo[]> {
    return [];
  }
}
