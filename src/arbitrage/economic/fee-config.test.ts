import Decimal from 'decimal.js';
import { computeMarketplaceTotalCost, validateFeeConfiguration, unconfirmedFeeConfig, FeeConfigurationIncompleteError, FeeConfigModel } from './fee-config';
import { MarketplaceIdSchema } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// IDEA.xml §100 (Never hardcode fees) + §3 (UNKNOWN != 0)
//
// These tests enforce that fee configurations MUST be explicitly provided.
// Missing fees throw — they NEVER silently default to 0.
// ─────────────────────────────────────────────────────────────────────────────

describe('Fee Configuration — UNKNOWN != 0 invariant', () => {
  it('computeMarketplaceTotalCost THROWS when any fee is null (IDEA.xml §3)', () => {
    const cfg: FeeConfigModel = unconfirmedFeeConfig('shopee');
    expect(() => computeMarketplaceTotalCost(cfg, Decimal(100000))).toThrow(FeeConfigurationIncompleteError);
    expect(() => computeMarketplaceTotalCost(cfg, Decimal(100000))).toThrow('commissionRate');
  });

  it('computes total cost when all fees provided', () => {
    const cfg: FeeConfigModel = {
      marketplace: 'shopee',
      commissionRate: 0.015, // 1.5%
      transactionFeeRate: 0.02, // 2%
      paymentFeeRate: 0.01, // 1%
      affiliateFeeRate: 0.03, // 3%
      campaignFee: 0,
      sellerVoucherCostRate: 0,
      freeShippingSubsidyCost: 0,
      allocatedAdSpendPerUnit: 0,
      outboundPackagingCost: 0,
      returnRefundLossProvision: 0,
      operationalHandlingCost: 0,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      evidence: {
        source: 'Shopee Seller Center API',
        sourceTier: 1,
        rawEvidenceHash: 'a'.repeat(64),
        observedAt: new Date(),
        confidence: 0.95,
      },
      version: '1.0.0',
    };

    // Selling price = 100000
    // Rates: 1.5% + 2% + 1% + 3% + 0% = 7.5% → 7500
    // flat fees: campaignFee(0) + freeShippingSubsidyCost(0) + allocatedAdSpendPerUnit(0) + outboundPackagingCost(0) + returnRefundLossProvision(0) + operationalHandlingCost(0) = 0
    const total = computeMarketplaceTotalCost(cfg, Decimal(100000));
    expect(total.toString()).toBe('7500');
  });

  it('validates that no required fee field is null', () => {
    const incomplete: FeeConfigModel = {
      marketplace: 'lazada',
      commissionRate: 0.01, // OK
      transactionFeeRate: null, // MISSING — should fail
      paymentFeeRate: null,
      affiliateFeeRate: null,
      campaignFee: null,
      sellerVoucherCostRate: null,
      freeShippingSubsidyCost: null,
      allocatedAdSpendPerUnit: null,
      outboundPackagingCost: null,
      returnRefundLossProvision: null,
      operationalHandlingCost: null,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      evidence: {
        source: 'test',
        sourceTier: 6,
        rawEvidenceHash: null,
        observedAt: new Date(),
        confidence: 0,
      },
      version: '0.0.0',
    };

    expect(() => validateFeeConfiguration([incomplete])).toThrow(FeeConfigurationIncompleteError);
  });
});

describe('Fee Configuration — MarketplaceIdSchema', () => {
  it('accepts valid marketplace IDs', () => {
    expect(() => MarketplaceIdSchema.parse('shopee')).not.toThrow();
    expect(() => MarketplaceIdSchema.parse('tokopedia')).not.toThrow();
    expect(() => MarketplaceIdSchema.parse('lazada')).not.toThrow();
    expect(() => MarketplaceIdSchema.parse('blibli')).not.toThrow();
    expect(() => MarketplaceIdSchema.parse('tiktok_shop')).not.toThrow();
  });

  it('rejects invalid marketplace IDs', () => {
    expect(() => MarketplaceIdSchema.parse('ebay')).toThrow();
    expect(() => MarketplaceIdSchema.parse('amazon')).toThrow();
  });
});

describe('Fee Configuration — unconfirmedFeeConfig factory', () => {
  it('creates all-fees-null config with confidence 0', () => {
    const cfg = unconfirmedFeeConfig('shopee');
    expect(cfg.commissionRate).toBeNull();
    expect(cfg.transactionFeeRate).toBeNull();
    expect(cfg.paymentFeeRate).toBeNull();
    expect(cfg.evidence.confidence).toBe(0);
    expect(cfg.evidence.sourceTier).toBe(6); // heuristic/unconfirmed
  });

  it('can never be used to compute profit (all fees null → throws)', () => {
    const cfg = unconfirmedFeeConfig('tokopedia');
    expect(() => computeMarketplaceTotalCost(cfg, Decimal(100000))).toThrow(FeeConfigurationIncompleteError);
  });
});
