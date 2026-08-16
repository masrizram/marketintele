export enum Marketplace {
  SHOPEE = 'shopee',
  TOKOPEDIA = 'tokopedia',
  LAZADA = 'lazada',
  BLIBLI = 'blibli',
  TIKTOK_SHOP = 'tiktok_shop',
  OTHER = 'other',
}

export enum VerificationStatus {
  VERIFIED = 'verified',
  PARTIALLY_VERIFIED = 'partially_verified',
  UNVERIFIED = 'unverified',
}

export enum CashbackType {
  INSTANT_DISCOUNT = 'instant_discount',
  AFTER_TRANSACTION = 'after_transaction',
  CONDITIONAL = 'conditional',
}

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

export interface UserPreferences {
  userId: number;
  budget: number | null;
  marketplaces: Marketplace[];
  categories: string[];
  keywords: string[];
  sellers: string[];
  minDiscountPercent: number | null;
  maxPrice: number | null;
  notificationsEnabled: boolean;
  notificationFrequency: string;
  searchMode: string;
}

export interface PromoHistory {
  id?: number;
  userId: number;
  promoId: string;
  marketplace: Marketplace;
  productName: string;
  checkoutTotal: number;
  sentAt: Date;
  action: string;
}
