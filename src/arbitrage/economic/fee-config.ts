import Decimal from 'decimal.js';

// ─────────────────────────────────────────────────────────────────────────────
// Marketplace Fee Configuration Model
//
// Aligns with IDEA.xml §27 (Marketplace Cost Engine).  Every marketplace fee
// MUST be explicitly configured before the profit engine will compute.  Missing
// fees do NOT default to zero — they throw FeeConfigurationIncompleteError.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete fee configuration for a single marketplace.
 */
export interface FeeConfigModel {
  marketplace: string;
  commissionRate?: number | null;
  transactionFeeRate?: number | null;
  paymentFeeRate?: number | null;
  affiliateFeeRate?: number | null;
  campaignFee?: number | null;
  sellerVoucherCostRate?: number | null;
  freeShippingSubsidyCost?: number | null;
  allocatedAdSpendPerUnit?: number | null;
  outboundPackagingCost?: number | null;
  returnRefundLossProvision?: number | null;
  operationalHandlingCost?: number | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  evidence: {
    source: string;
    sourceTier: 1 | 2 | 3 | 4 | 5 | 6;
    rawEvidenceHash: string | null;
    observedAt: Date;
    confidence: number;
  };
  version: string;
}

/**
 * Validate that fee configuration is complete for all active marketplaces.
 *
 * Throws FeeConfigurationIncompleteError if any fee is missing.
 */
export function validateFeeConfiguration(
  configs: FeeConfigModel[],
  requiredFields: (keyof FeeConfigModel)[] = [
    'commissionRate',
    'transactionFeeRate',
    'paymentFeeRate',
    'affiliateFeeRate',
    'campaignFee',
    'sellerVoucherCostRate',
  ],
): void {
  const missing: string[][] = [];

  for (const cfg of configs) {
    const missingFields: string[] = [];
    for (const field of requiredFields) {
      const val = cfg[field];
      if (val === null || val === undefined) {
        missingFields.push(field);
      }
    }
    if (missingFields.length > 0) {
      missing.push([cfg.marketplace, ...missingFields]);
    }
  }

  if (missing.length > 0) {
    const details = missing
      .map(([m, ...fields]) => `  ${m}: missing ${fields.join(', ')}`)
      .join('\n');
    throw new FeeConfigurationIncompleteError(
      `Incomplete fee configuration for ${missing.length} marketplace(s):\n${details}\n\n` +
        `Fees cannot be assumed 0 — provide complete configuration or mark as UNCONFIRMED.`,
    );
  }
}

/**
 * Compute total marketplace cost per unit given a selling price.
 *
 * Returns 0 if all fees are 0.  Throws if any fee is missing (null).
 */
export function computeMarketplaceTotalCost(
  cfg: FeeConfigModel,
  sellingPrice: Decimal,
): Decimal {
  const selling = sellingPrice.abs();

  const components: Decimal[] = [];

  const addRate = (rate: number | null | undefined, label: string) => {
    if (rate === null || rate === undefined) {
      throw new FeeConfigurationIncompleteError(
        `Missing fee '${label}' for ${cfg.marketplace} — cannot assume 0`,
      );
    }
    components.push(selling.times(rate));
  };

  const addFlat = (value: number | null | undefined, label: string) => {
    if (value === null || value === undefined) {
      throw new FeeConfigurationIncompleteError(
        `Missing fee '${label}' for ${cfg.marketplace} — cannot assume 0`,
      );
    }
    components.push(new Decimal(value));
  };

  addRate(cfg.commissionRate, 'commissionRate');
  addRate(cfg.transactionFeeRate, 'transactionFeeRate');
  addRate(cfg.paymentFeeRate, 'paymentFeeRate');
  addRate(cfg.affiliateFeeRate, 'affiliateFeeRate');
  addRate(cfg.sellerVoucherCostRate, 'sellerVoucherCostRate');
  addFlat(cfg.campaignFee, 'campaignFee');
  addFlat(cfg.freeShippingSubsidyCost, 'freeShippingSubsidyCost');
  addFlat(cfg.allocatedAdSpendPerUnit, 'allocatedAdSpendPerUnit');
  addFlat(cfg.outboundPackagingCost, 'outboundPackagingCost');
  addFlat(cfg.returnRefundLossProvision, 'returnRefundLossProvision');
  addFlat(cfg.operationalHandlingCost, 'operationalHandlingCost');

  return components.reduce((sum, c) => sum.plus(c), new Decimal(0));
}

/**
 * Factory: build a default fee config with everything set to null (unconfirmed).
 */
export function unconfirmedFeeConfig(
  marketplace: string,
  version = '0.0.0-unconfirmed',
  source = 'UNCONFIRMED — placeholder until external fee data is ingested',
): FeeConfigModel {
  return {
    marketplace,
    commissionRate: null,
    transactionFeeRate: null,
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
      source,
      sourceTier: 6, // heuristic / unconfirmed
      rawEvidenceHash: null,
      observedAt: new Date(),
      confidence: 0,
    },
    version,
  };
}

export class FeeConfigurationIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeConfigurationIncompleteError';
  }
}

export class FeeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeValidationError';
  }
}
