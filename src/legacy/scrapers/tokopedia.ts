import { UserPreferences, Marketplace } from '../models';
import { BaseScraper, Promo, defaultContext } from './base';

export class TokopediaScraper extends BaseScraper {
  marketplace = Marketplace.TOKOPEDIA;

  async search(_prefs: UserPreferences, _ctx = defaultContext, _rp0Mode = false): Promise<Promo[]> {
    return [];
  }
}
