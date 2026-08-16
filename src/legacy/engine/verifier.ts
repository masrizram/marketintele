import { Promo, VerificationStatus } from '../models';

export function verifyPromo(promo: Promo): VerificationStatus {
  let score = 0;
  let maxScore = 0;

  maxScore += 20;
  if (promo.productName && promo.sellerName) {
    score += 10;
  }

  maxScore += 20;
  if (promo.originalPrice > 0 && promo.listingPrice >= 0) {
    score += 10;
  }

  maxScore += 20;
  if (promo.voucherCode || (promo.storeVoucher > 0 || promo.marketplaceVoucher > 0)) {
    score += 10;
  }

  maxScore += 20;
  if (promo.checkoutTotal >= 0) {
    score += 10;
  }

  maxScore += 20;
  if (promo.verifiedAt) {
    score += 20;
  } else if (promo.detectedAt) {
    const ageHours = (Date.now() - promo.detectedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours <= 6) {
      score += 10;
    }
  }

  promo.confidenceScore = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  if (score >= 80) {
    promo.verificationStatus = VerificationStatus.VERIFIED;
  } else if (score >= 50) {
    promo.verificationStatus = VerificationStatus.PARTIALLY_VERIFIED;
  } else {
    promo.verificationStatus = VerificationStatus.UNVERIFIED;
  }

  if (!promo.verifiedAt && promo.verificationStatus !== VerificationStatus.UNVERIFIED) {
    promo.verifiedAt = new Date();
  }

  return promo.verificationStatus;
}
