import { VerificationStatus, CashbackType } from '../models';
import { calculateSavings, calculateSavingsPercentage, isRp0Checkout, isEffectiveRp0 } from '../engine';

const VERIFIED_EMOJI = '🟢';
const PARTIALLY_EMOJI = '🟡';
const UNVERIFIED_EMOJI = '🔴';

export function verificationEmoji(status: VerificationStatus): string {
  if (status === VerificationStatus.VERIFIED) return VERIFIED_EMOJI;
  if (status === VerificationStatus.PARTIALLY_VERIFIED) return PARTIALLY_EMOJI;
  return UNVERIFIED_EMOJI;
}

export function formatVerifiedNotification(promo: any): string {
  const rp0 = isRp0Checkout(promo);
  const effRp0 = isEffectiveRp0(promo);

  let title: string;
  if (rp0) {
    title = '🔥 *RP0 CHECKOUT TERDETEKSI*';
  } else if (effRp0) {
    title = '🟡 *RP0 EFEKTIF*';
  } else {
    title = '🔥 *PROMO SUPER MURAH*';
  }

  const lines: string[] = [
    title,
    `🛒 Marketplace: ${promo.marketplace}`,
    `🏪 Toko: ${promo.sellerName || 'Tidak diketahui'}`,
    `📦 Produk: ${promo.productName}`,
    `💰 Harga awal: Rp${promo.originalPrice.toLocaleString('id-ID')}`,
    `🏷️ Diskon produk: -Rp${promo.productDiscount.toLocaleString('id-ID')}`,
  ];

  if (promo.storeVoucher > 0) lines.push(`🎟️ Voucher toko: -Rp${promo.storeVoucher.toLocaleString('id-ID')}`);
  if (promo.marketplaceVoucher > 0) lines.push(`🎟️ Voucher marketplace: -Rp${promo.marketplaceVoucher.toLocaleString('id-ID')}`);
  if (promo.paymentDiscount > 0) lines.push(`💳 Diskon pembayaran: -Rp${promo.paymentDiscount.toLocaleString('id-ID')}`);
  if (promo.shippingDiscount > 0) lines.push(`🚚 Diskon ongkir: -Rp${promo.shippingDiscount.toLocaleString('id-ID')}`);

  lines.push(`🚚 Ongkir: Rp${promo.shippingCost.toLocaleString('id-ID')}`);
  if (promo.serviceFee > 0) lines.push(`💼 Biaya layanan: Rp${promo.serviceFee.toLocaleString('id-ID')}`);
  if (promo.otherRequiredFee > 0) lines.push(`➕ Biaya lain: Rp${promo.otherRequiredFee.toLocaleString('id-ID')}`);

  if (rp0) {
    lines.push('💰 **TOTAL CHECKOUT: Rp0**');
  } else {
    lines.push(`💰 **TOTAL CHECKOUT: Rp${promo.checkoutTotal.toLocaleString('id-ID')}**`);
  }

  if (promo.cashback > 0 && promo.cashbackType !== CashbackType.INSTANT_DISCOUNT) {
    lines.push(`🎁 Cashback: Rp${promo.cashback.toLocaleString('id-ID')}`);
    lines.push(`💰 Effective Cost: Rp${promo.effectiveCost.toLocaleString('id-ID')}`);
  }

  const savings = calculateSavings(promo);
  const savingsPct = calculateSavingsPercentage(promo);
  lines.push(`📉 Hemat: Rp${savings.toLocaleString('id-ID')} (${savingsPct.toFixed(1)}%)`);

  if (promo.voucherCode) {
    lines.push(`🎟️ Kode: \`${promo.voucherCode}\``);
  }

  if (promo.promoEnd) {
    lines.push(`⏰ Berlaku sampai: ${promo.promoEnd.toISOString().slice(0, 16).replace('T', ' ')}`);
  }

  if (promo.userConditions && promo.userConditions.length > 0) {
    lines.push('📌 Syarat utama:');
    for (const c of promo.userConditions.slice(0, 3)) {
      lines.push(`- ${c}`);
    }
  }

  const emoji = verificationEmoji(promo.verificationStatus);
  const statusText =
    promo.verificationStatus === VerificationStatus.VERIFIED
      ? 'Terverifikasi'
      : promo.verificationStatus === VerificationStatus.PARTIALLY_VERIFIED
        ? 'Sebagian Terverifikasi'
        : 'Belum Terverifikasi';
  lines.push(`${emoji} Status: ${statusText}`);
  lines.push(`🔎 Confidence: ${promo.confidenceScore}%`);

  if (promo.productUrl) {
    lines.push(`🔗 [Lihat produk](${promo.productUrl})`);
  } else {
    lines.push('🔗 Link: Tidak tersedia');
  }

  lines.push('⚠️ Promo dapat berubah sewaktu-waktu. Verifikasi kembali di checkout sebelum membayar.');
  return lines.join('\n');
}

export function formatUnverifiedNotification(promo: any): string {
  const lines: string[] = [
    '🔥 *PROMO BERPOTENSI MURAH*',
    `🛒 Marketplace: ${promo.marketplace}`,
    `🏪 Toko: ${promo.sellerName || 'Tidak diketahui'}`,
    `📦 Produk: ${promo.productName}`,
    `💰 Estimasi total checkout: Rp${promo.checkoutTotal.toLocaleString('id-ID')}`,
    `📉 Estimasi hemat: ${calculateSavingsPercentage(promo).toFixed(1)}%`,
  ];

  if (promo.voucherCode) {
    lines.push(`🎟️ Kode: \`${promo.voucherCode}\``);
  }

  lines.push('🔴 Status: Belum Terverifikasi');
  lines.push('⚠️ Data belum sepenuhnya diverifikasi. Periksa kembali di checkout.');
  if (promo.productUrl) {
    lines.push(`🔗 [Lihat produk](${promo.productUrl})`);
  }
  return lines.join('\n');
}
