import { Marketplace, UserPreferences, VerificationStatus, CashbackType } from '../models';
import { calculateCheckoutTotal, calculateEffectiveCost } from '../engine';

export interface Promo {
  promoId: string;
  marketplace: Marketplace;
  productId: string;
  sellerId: string;
  productName: string;
  sellerName: string;
  productUrl: string;
  originalPrice: number;
  listingPrice: number;
  productDiscount: number;
  storeVoucher: number;
  marketplaceVoucher: number;
  paymentDiscount: number;
  shippingDiscount: number;
  otherDiscount: number;
  shippingCost: number;
  serviceFee: number;
  otherRequiredFee: number;
  cashback: number;
  cashbackType: CashbackType;
  minimumPurchase: number;
  maximumDiscount: number | null;
  voucherCode: string | null;
  voucherQuota: number | null;
  promoStart: Date | null;
  promoEnd: Date | null;
  checkoutTotal: number;
  effectiveCost: number;
  verificationStatus: VerificationStatus;
  confidenceScore: number;
  detectedAt: Date;
  verifiedAt: Date | null;
  userConditions: string[];
  paymentConditions: string[];
  regionConditions: string[];
  categoryConditions: string[];
  sellerConditions: string[];
  productConditions: string[];
  quantityConditions: string[];
  stackingNotes: string[];
}

export interface ScraperContext {
  requestTimeout: number;
  delayMin: number;
  delayMax: number;
}

export const defaultContext: ScraperContext = {
  requestTimeout: 15000,
  delayMin: 1000,
  delayMax: 3000,
};

export abstract class BaseScraper {
  abstract marketplace: Marketplace;
  abstract search(prefs: UserPreferences, ctx: ScraperContext, rp0Mode: boolean): Promise<Promo[]>;
}

export function toPromo(raw: Partial<Promo>): Promo {
  const now = new Date();
  const promo: Promo = {
    promoId: raw.promoId || '',
    marketplace: raw.marketplace || Marketplace.OTHER,
    productId: raw.productId || '',
    sellerId: raw.sellerId || '',
    productName: raw.productName || '',
    sellerName: raw.sellerName || '',
    productUrl: raw.productUrl || '',
    originalPrice: raw.originalPrice || 0,
    listingPrice: raw.listingPrice || 0,
    productDiscount: raw.productDiscount || 0,
    storeVoucher: raw.storeVoucher || 0,
    marketplaceVoucher: raw.marketplaceVoucher || 0,
    paymentDiscount: raw.paymentDiscount || 0,
    shippingDiscount: raw.shippingDiscount || 0,
    otherDiscount: raw.otherDiscount || 0,
    shippingCost: raw.shippingCost || 0,
    serviceFee: raw.serviceFee || 0,
    otherRequiredFee: raw.otherRequiredFee || 0,
    cashback: raw.cashback || 0,
    cashbackType: raw.cashbackType || CashbackType.AFTER_TRANSACTION,
    minimumPurchase: raw.minimumPurchase || 0,
    maximumDiscount: raw.maximumDiscount ?? null,
    voucherCode: raw.voucherCode || null,
    voucherQuota: raw.voucherQuota ?? null,
    promoStart: raw.promoStart || null,
    promoEnd: raw.promoEnd || null,
    checkoutTotal: raw.checkoutTotal || 0,
    effectiveCost: raw.effectiveCost || 0,
    verificationStatus: raw.verificationStatus || VerificationStatus.UNVERIFIED,
    confidenceScore: raw.confidenceScore || 0,
    detectedAt: raw.detectedAt || now,
    verifiedAt: raw.verifiedAt || null,
    userConditions: raw.userConditions || [],
    paymentConditions: raw.paymentConditions || [],
    regionConditions: raw.regionConditions || [],
    categoryConditions: raw.categoryConditions || [],
    sellerConditions: raw.sellerConditions || [],
    productConditions: raw.productConditions || [],
    quantityConditions: raw.quantityConditions || [],
    stackingNotes: raw.stackingNotes || [],
  };
  calculateCheckoutTotal(promo);
  calculateEffectiveCost(promo);
  return promo;
}
