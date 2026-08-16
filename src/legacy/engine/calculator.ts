import { Promo, CashbackType } from '../models';

export function calculateCheckoutTotal(promo: Promo): number {
  const total = promo.listingPrice
    - promo.productDiscount
    - promo.storeVoucher
    - promo.marketplaceVoucher
    - promo.paymentDiscount
    - promo.otherDiscount
    + promo.shippingCost
    + promo.serviceFee
    + promo.otherRequiredFee;
  promo.checkoutTotal = Math.max(total, 0);
  return promo.checkoutTotal;
}

export function calculateEffectiveCost(promo: Promo): number {
  if (promo.cashbackType === CashbackType.INSTANT_DISCOUNT) {
    promo.effectiveCost = Math.max(promo.checkoutTotal - promo.cashback, 0);
  } else {
    promo.effectiveCost = promo.checkoutTotal;
  }
  return promo.effectiveCost;
}

export function calculateSavings(promo: Promo): number {
  return promo.originalPrice - promo.checkoutTotal;
}

export function calculateSavingsPercentage(promo: Promo): number {
  if (promo.originalPrice <= 0) return 0;
  return (calculateSavings(promo) / promo.originalPrice) * 100;
}

export function applyVoucherCap(price: number, discountPercent: number, maxDiscount: number | null): number {
  if (maxDiscount !== null) {
    return Math.min(price * (discountPercent / 100), maxDiscount);
  }
  return price * (discountPercent / 100);
}

export function isRp0Checkout(promo: Promo): boolean {
  return promo.checkoutTotal === 0;
}

export function isEffectiveRp0(promo: Promo): boolean {
  return promo.effectiveCost === 0 && promo.checkoutTotal > 0;
}
