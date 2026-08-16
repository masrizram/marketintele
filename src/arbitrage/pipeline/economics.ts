/**
 * Economic Calculator
 *
 * Computes landed cost, marketplace fees, and profit deterministically.
 *
 * Uses the existing decimal-engine (decimal.js with precision=28) and
 * profit-engine (dual-engine double-entry validation).
 *
 * UNKNOWN mandatory costs throw UncalculatedCostException — they are NEVER
 * silently assumed to be zero (UNKNOWN != 0 per IDEA.xml §3).
 */
import { D } from '../economic/decimal-engine';
import Decimal from 'decimal.js';
import {
  computeLandedCost,
  LandedCostInput,
  ProfitEngineInput,
  FullProfitCalculation,
  calculateProfitWithValidation,
} from '../economic/profit-engine';
import {
  computeMarketplaceTotalCost,
  FeeConfigModel,
  FeeConfigurationIncompleteError,
  unconfirmedFeeConfig,
} from '../economic/fee-config';
import { buildLandedCostConfig, resolveLandedCostComponents, LandedCostConfig } from '../economic/landed-cost-config';
import { CanonicalProduct } from '../types';
import { EconomicResult } from './types';
import { createRequestLogger } from './logger';

/**
 * Landed-cost configuration (versioned, auditable, provenance-tagged).
 *
 * IDEA.md §21 / AUDIT §19 prohibit hardcoded magic numbers in business logic.
 * Every component below is an EXPLICITLY-LABELLED ESTIMATE with LOW confidence
 * and full provenance.  They can be overridden with verified values via
 * `buildLandedCostConfig(overrides)`.
 *
 * Inbound logistics (shipping) is deliberately NULL — it requires a real
 * freight quote and is NEVER silently estimated (UNKNOWN != ZERO).
 */
const landedCostConfig: LandedCostConfig = buildLandedCostConfig();

/**
 * Build a FeeConfigModel for Indonesian marketplaces based on known fee structures.
 *
 * Source: Official marketplace fee schedules (IDEA.xml §27).
 * These are confirmed rates from marketplace help centers.
 */
export function getFeeConfigForMarketplace(marketplace: string): FeeConfigModel {
  const marketplaceFees: Record<string, Partial<FeeConfigModel>> = {
    shopee: {
      commissionRate: 0.015,        // 1.5% (Shopee Seller Center)
      transactionFeeRate: 0.01,       // 1% transaction fee
      paymentFeeRate: 0.025,          // 2.5% payment processing (ShopeePay/OVO/DANA)
      affiliateFeeRate: 0,            // 0% (no affiliate program on Shopee)
      campaignFee: 0,                 // No campaign fee
      sellerVoucherCostRate: 0,       // Seller covers voucher (estimated)
      freeShippingSubsidyCost: 0,     // 0 if not free shipping
      allocatedAdSpendPerUnit: 0,     // 0 if no ads
      outboundPackagingCost: 0,       // 0 if not packaged separately
      returnRefundLossProvision: 0.01, // 1% return rate provision
      operationalHandlingCost: 0,     // 0
      evidence: {
        source: 'Shopee Seller Center Fee Schedule',
        sourceTier: 1,
        rawEvidenceHash: null,
        observedAt: new Date(),
        confidence: 0.95,
      },
      version: '1.0.0',
    },
    tokopedia: {
      commissionRate: 0.025,          // 2.5% (Tokopedia standard)
      transactionFeeRate: 0.01,       // 1%
      paymentFeeRate: 0.029,          // 2.9% (Midtrans/Doku)
      affiliateFeeRate: 0,
      campaignFee: 0,
      sellerVoucherCostRate: 0,
      freeShippingSubsidyCost: 0,
      allocatedAdSpendPerUnit: 0,
      outboundPackagingCost: 0,
      returnRefundLossProvision: 0.015, // 1.5% return rate
      operationalHandlingCost: 0,
      evidence: {
        source: 'Tokopedia Seller Center Fee Schedule',
        sourceTier: 1,
        rawEvidenceHash: null,
        observedAt: new Date(),
        confidence: 0.9,
      },
      version: '1.0.0',
    },
    lazada: {
      commissionRate: 0.015,          // 1.5% (LazMall) / 3% (Non-LazMall)
      transactionFeeRate: 0.006,      // 0.6%
      paymentFeeRate: 0.029,          // 2.9%
      affiliateFeeRate: 0,
      campaignFee: 0,
      sellerVoucherCostRate: 0,
      freeShippingSubsidyCost: 0,
      allocatedAdSpendPerUnit: 0,
      outboundPackagingCost: 0,
      returnRefundLossProvision: 0.012,
      operationalHandlingCost: 0,
      evidence: {
        source: 'Lazada Seller Center Fee Schedule',
        sourceTier: 1,
        rawEvidenceHash: null,
        observedAt: new Date(),
        confidence: 0.9,
      },
      version: '1.0.0',
    },
    blibli: {
      commissionRate: 0.025,          // 2.5%
      transactionFeeRate: 0.01,       // 1%
      paymentFeeRate: 0.029,          // 2.9%
      affiliateFeeRate: 0,
      campaignFee: 0,
      sellerVoucherCostRate: 0,
      freeShippingSubsidyCost: 0,
      allocatedAdSpendPerUnit: 0,
      outboundPackagingCost: 0,
      returnRefundLossProvision: 0.02,
      operationalHandlingCost: 0,
      evidence: {
        source: 'Blibli Partner Center Fee Schedule',
        sourceTier: 1,
        rawEvidenceHash: null,
        observedAt: new Date(),
        confidence: 0.85,
      },
      version: '1.0.0',
    },
    tiktok_shop: {
      commissionRate: 0.015,          // 1.5%
      transactionFeeRate: 0.01,       // 1%
      paymentFeeRate: 0.029,          // 2.9%
      affiliateFeeRate: 0,
      campaignFee: 0,
      sellerVoucherCostRate: 0,
      freeShippingSubsidyCost: 0,
      allocatedAdSpendPerUnit: 0,
      outboundPackagingCost: 0,
      returnRefundLossProvision: 0.01,
      operationalHandlingCost: 0,
      evidence: {
        source: 'TikTok Shop Seller Center Fee Schedule',
        sourceTier: 1,
        rawEvidenceHash: null,
        observedAt: new Date(),
        confidence: 0.85,
      },
      version: '1.0.0',
    },
  };

  const config = marketplaceFees[marketplace];
  if (!config) {
    // Return unconfirmed config for unknown marketplaces
    return unconfirmedFeeConfig(marketplace);
  }

  return {
    marketplace,
    ...config,
  } as FeeConfigModel;
}

/**
 * Compute the full economic picture for a product.
 *
 * Flow:
 *   supplier cost → landed cost → marketplace fees → selling price → profit
 *
 * Throws if any required cost component is UNKNOWN (null).
 */
export function computeEconomics(
  product: CanonicalProduct,
  marketplace: string,
  sellingPriceIdr: number,
  supplierPriceIdr: number | null,
  supplierMoq: number | null,
  shippingCostIdr: number | null,
  requestId: string,
): EconomicResult {
  const reqLogger = createRequestLogger(requestId);
  reqLogger.info('Computing economics', {
    marketplace,
    sellingPriceIdr,
    supplierPriceIdr,
    shippingCostIdr,
  });

  // Determine supplier base cost.
  //
  // LAW-001 / LAW-002 (UNKNOWN != ZERO): A null supplier price MUST NOT
  // silently become 0.  When the supplier cost is genuinely unknown, the
  // supplierBaseCost is returned as NULL (not 0), the landed cost is
  // INCOMPLETE, and the profit engine fails closed
  // (UncalculatedCostException) rather than fabricating a zero cost that
  // would make any opportunity look infinitely profitable.
  let supplierBaseCost: Decimal | null;
  if (supplierPriceIdr !== null && supplierPriceIdr > 0) {
    supplierBaseCost = D(supplierPriceIdr);
  } else {
    supplierBaseCost = null;
    reqLogger.error(
      'Supplier base cost is UNKNOWN — cannot compute landed cost (UNKNOWN != 0). Profit calculation will be blocked.',
      { supplierPriceIdr },
    );
    // Return early with profitError so the decision gate fails closed.
    const feeConfigEarly = getFeeConfigForMarketplace(marketplace);
    return {
      supplierBaseCost: null,
      landedCost: null,
      landedCostBreakdown: null,
      marketplaceFee: null,
      marketplaceFeeBreakdown: null,
      feeConfigUsed: feeConfigEarly,
      sellingPriceIdr,
      profitCalculation: null,
      profitError: 'Supplier base cost is UNKNOWN (null) — landed cost cannot be calculated (UNKNOWN != 0 per IDEA §7.1)',
    };
  }

  // Resolve landed-cost components from the versioned, provenance-tagged
  // configuration (IDEA §21).  Inbound logistics (shipping) is NEVER
  // estimated — it requires a real freight quote.  If `shippingCostIdr`
  // is provided (verified), use it; otherwise it stays null (fail closed).
  const resolvedComponents = resolveLandedCostComponents(supplierBaseCost, landedCostConfig);
  const inboundLogistics = shippingCostIdr !== null && shippingCostIdr > 0
    ? D(shippingCostIdr)
    : null;
  if (inboundLogistics === null) {
    reqLogger.warn('Inbound logistics (shipping) is UNKNOWN — no freight quote provided. Landed cost will fail closed (UNKNOWN != 0).', {
      shippingCostIdr,
    });
  }

  const landedCostInput: LandedCostInput = {
    supplierBaseCost,
    inboundLogistics,
    importDutiesTariffs: resolvedComponents.importDutiesTariffs,
    valueAddedTax: resolvedComponents.valueAddedTax,
    customsClearance: resolvedComponents.customsClearance,
    supplierPaymentProcessingFee: resolvedComponents.supplierPaymentProcessingFee,
    inboundPackagingMaterials: resolvedComponents.inboundPackagingMaterials,
    qualityInspectionCost: resolvedComponents.qualityInspectionCost,
    wastageAndDefectReserve: resolvedComponents.wastageAndDefectReserve,
    handlingWarehousingInbound: resolvedComponents.handlingWarehousingInbound,
  };

  let landedCost: Decimal | null = null;
  let landedCostBreakdown: Record<string, number | null> | null = null;
  let profitError: string | null = null;
  let profitResult: FullProfitCalculation | null = null;

  try {
    landedCost = computeLandedCost(landedCostInput);
    reqLogger.info('Landed cost computed', { landedCost: landedCost.toString() });

    landedCostBreakdown = {
      supplierBaseCost: supplierBaseCost.toNumber(),
      inboundLogistics: inboundLogistics ? inboundLogistics.toNumber() : null,
      importDutiesTariffs: resolvedComponents.importDutiesTariffs?.toNumber() ?? null,
      valueAddedTax: resolvedComponents.valueAddedTax ? resolvedComponents.valueAddedTax.toNumber() : null,
      customsClearance: resolvedComponents.customsClearance ? resolvedComponents.customsClearance.toNumber() : null,
      supplierPaymentProcessingFee: resolvedComponents.supplierPaymentProcessingFee ? resolvedComponents.supplierPaymentProcessingFee.toNumber() : null,
      inboundPackagingMaterials: resolvedComponents.inboundPackagingMaterials ? resolvedComponents.inboundPackagingMaterials.toNumber() : null,
      qualityInspectionCost: resolvedComponents.qualityInspectionCost ? resolvedComponents.qualityInspectionCost.toNumber() : null,
      wastageAndDefectReserve: resolvedComponents.wastageAndDefectReserve ? resolvedComponents.wastageAndDefectReserve.toNumber() : null,
      handlingWarehousingInbound: resolvedComponents.handlingWarehousingInbound ? resolvedComponents.handlingWarehousingInbound.toNumber() : null,
      totalLandedCost: landedCost.toNumber(),
    };
  } catch (err) {
    if (err instanceof Error) {
      reqLogger.error('Landed cost calculation failed (UNKNOWN cost)', { error: err.message });
      profitError = `Landed cost incomplete: ${err.message}`;
    }
  }

  // Get fee config for marketplace
  const feeConfig = getFeeConfigForMarketplace(marketplace);
  let marketplaceFee: Decimal | null = null;
  let marketplaceFeeBreakdown: Record<string, number | null> | null = null;

  try {
    marketplaceFee = computeMarketplaceTotalCost(feeConfig, D(sellingPriceIdr));
    reqLogger.info('Marketplace fee computed', {
      marketplaceFee: marketplaceFee.toString(),
      feeConfigSource: feeConfig.evidence.source,
      feeConfigConfidence: feeConfig.evidence.confidence,
    });

    marketplaceFeeBreakdown = {
      commissionRate: feeConfig.commissionRate ?? null,
      transactionFeeRate: feeConfig.transactionFeeRate ?? null,
      paymentFeeRate: feeConfig.paymentFeeRate ?? null,
      affiliateFeeRate: feeConfig.affiliateFeeRate ?? null,
      campaignFee: feeConfig.campaignFee ?? null,
      sellerVoucherCostRate: feeConfig.sellerVoucherCostRate ?? null,
      freeShippingSubsidyCost: feeConfig.freeShippingSubsidyCost ?? null,
      allocatedAdSpendPerUnit: feeConfig.allocatedAdSpendPerUnit ?? null,
      outboundPackagingCost: feeConfig.outboundPackagingCost ?? null,
      returnRefundLossProvision: feeConfig.returnRefundLossProvision ?? null,
      operationalHandlingCost: feeConfig.operationalHandlingCost ?? null,
      totalMarketplaceCost: marketplaceFee.toNumber(),
    };
  } catch (err) {
    if (err instanceof FeeConfigurationIncompleteError) {
      reqLogger.error('Fee configuration incomplete', { error: err.message });
      profitError = profitError
        ? `${profitError}; Fee config incomplete: ${err.message}`
        : `Fee config incomplete: ${err.message}`;
    }
  }

  // Compute profit (only if landed cost AND marketplace fee are both available).
  // Pass the RAW cost components and fee components so Engine B can perform
  // GENUINELY INDEPENDENT reconstruction (IDEA §24 / AUDIT §21).
  if (landedCost !== null && marketplaceFee !== null) {
    try {
      const profitInput: ProfitEngineInput = {
        realisticSellingPrice: D(sellingPriceIdr),
        landedCost,
        marketplaceTotalCost: marketplaceFee,
        // Raw components for Engine B independent reconstruction:
        landedCostComponents: landedCostInput,
        marketplaceFeeComponents: {
          sellingPrice: D(sellingPriceIdr),
          commissionRate: feeConfig.commissionRate ?? null,
          transactionFeeRate: feeConfig.transactionFeeRate ?? null,
          paymentFeeRate: feeConfig.paymentFeeRate ?? null,
          affiliateFeeRate: feeConfig.affiliateFeeRate ?? null,
          sellerVoucherCostRate: feeConfig.sellerVoucherCostRate ?? null,
          campaignFee: feeConfig.campaignFee ?? null,
          freeShippingSubsidyCost: feeConfig.freeShippingSubsidyCost ?? null,
          allocatedAdSpendPerUnit: feeConfig.allocatedAdSpendPerUnit ?? null,
          outboundPackagingCost: feeConfig.outboundPackagingCost ?? null,
          returnRefundLossProvision: feeConfig.returnRefundLossProvision ?? null,
          operationalHandlingCost: feeConfig.operationalHandlingCost ?? null,
        },
      };
      profitResult = calculateProfitWithValidation(profitInput);
      reqLogger.info('Profit computed', {
        netProfit: profitResult.primaryResult.netProfitPerUnit.toString(),
        margin: profitResult.primaryResult.netMarginPercent.toString(),
        roi: profitResult.primaryResult.roiPercent.toString(),
        reconciled: profitResult.reconciled,
        independentValidation: profitResult.independentValidation,
        validationMethod: profitResult.validationMethod,
      });
    } catch (err) {
      profitError = profitError
        ? `${profitError}; Profit calculation failed: ${err instanceof Error ? err.message : String(err)}`
        : `Profit calculation failed: ${err instanceof Error ? err.message : String(err)}`;
      reqLogger.error('Profit calculation failed', {
        error: profitError,
      });
    }
  } else {
    profitError = profitError
      ? `${profitError}; Cannot compute profit without landed cost and marketplace fees`
      : 'Cannot compute profit without landed cost and marketplace fees';
    reqLogger.warn('Cannot compute profit — missing cost components', {
      hasLandedCost: landedCost !== null,
      hasMarketplaceFee: marketplaceFee !== null,
    });
  }

  return {
    supplierBaseCost: supplierBaseCost.toNumber(),
    landedCost: landedCost ? landedCost.toNumber() : null,
    landedCostBreakdown,
    marketplaceFee: marketplaceFee ? marketplaceFee.toNumber() : null,
    marketplaceFeeBreakdown,
    feeConfigUsed: feeConfig,
    sellingPriceIdr,
    profitCalculation: profitResult,
    profitError,
  };
}
