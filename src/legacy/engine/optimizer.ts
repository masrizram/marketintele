import { Promo, UserPreferences } from '../models';
import { calculateCheckoutTotal, calculateEffectiveCost, isRp0Checkout, isEffectiveRp0 } from './calculator';

export function rankPromos(promos: Promo[], prefs: UserPreferences): Promo[] {
  for (const p of promos) {
    calculateCheckoutTotal(p);
    calculateEffectiveCost(p);
  }

  const mode = prefs.searchMode;
  promos.sort((a, b) => {
    const aRp0 = isRp0Checkout(a) ? 0 : isEffectiveRp0(a) ? 1 : 2;
    const bRp0 = isRp0Checkout(b) ? 0 : isEffectiveRp0(b) ? 1 : 2;

    const aPrimary = mode === 'effective_cost' ? a.effectiveCost : a.checkoutTotal;
    const bPrimary = mode === 'effective_cost' ? b.effectiveCost : b.checkoutTotal;

    if (aRp0 !== bRp0) return aRp0 - bRp0;
    if (aPrimary !== bPrimary) return aPrimary - bPrimary;
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    const aTime = (a.verifiedAt || a.detectedAt).getTime();
    const bTime = (b.verifiedAt || b.detectedAt).getTime();
    return bTime - aTime;
  });

  return promos;
}

export function filterByBudget(promos: Promo[], budget: number | null): Promo[] {
  if (budget === null) return promos;
  return promos.filter(p => p.checkoutTotal <= budget);
}

export function filterBySearchMode(promos: Promo[], mode: string): Promo[] {
  if (mode === 'rp0') {
    return promos.filter(p => isRp0Checkout(p) || isEffectiveRp0(p) || p.checkoutTotal <= 5000);
  }
  if (mode === 'murah') {
    return [...promos].sort((a, b) => a.checkoutTotal - b.checkoutTotal);
  }
  return promos;
}
