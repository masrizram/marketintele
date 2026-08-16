import Decimal from 'decimal.js';
import { ZERO, add, sub, percentage as pct, round4, formatRp, validateReconciliation, DivisionByZeroError } from '../economic/decimal-engine';
import { UncalculatedCostException, CalculationConflictError, D } from '../economic/decimal-engine';

// ─────────────────────────────────────────────────────────────────────────────
// LANDED COST MODEL
// ─────────────────────────────────────────────────────────────────────────────
//
// Landed_Cost = Supplier_Base_Cost
//             + Inbound_Logistics
//             + Import_Duties_Tariffs
//             + Value_Added_Tax
//             + Customs_Clearance
//             + Supplier_Payment_Processing_Fee
//             + Inbound_Packaging_Materials
//             + Quality_Inspection_Cost
//             + Wastage_and_Defect_Reserve
//             + Handling_Warehousing_Inbound
//
// Each component MUST be explicitly provided.  UNKNOWN components throw.
// This is the UNKNOWN != 0 invariant from IDEA.xml §3.

export interface LandedCostInput {
  supplierBaseCost: Decimal;
  inboundLogistics: Decimal | null;
  importDutiesTariffs: Decimal | null;
  valueAddedTax: Decimal | null;
  customsClearance: Decimal | null;
  supplierPaymentProcessingFee: Decimal | null;
  inboundPackagingMaterials: Decimal | null;
  qualityInspectionCost: Decimal | null;
  wastageAndDefectReserve: Decimal | null;
  handlingWarehousingInbound: Decimal | null;
}

const REQUIRED_LANDED_COST_COMPONENTS = [
  'inboundLogistics',
  'importDutiesTariffs',
  'valueAddedTax',
  'customsClearance',
  'supplierPaymentProcessingFee',
  'inboundPackagingMaterials',
  'qualityInspectionCost',
  'wastageAndDefectReserve',
  'handlingWarehousingInbound',
];

export function computeLandedCost(input: LandedCostInput): Decimal {
  const missing: string[] = [];
  for (const key of REQUIRED_LANDED_COST_COMPONENTS) {
    const val = (input as unknown as { [k: string]: Decimal | null })[key];
    if (val === null || val === undefined) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new UncalculatedCostException(
      `Landed cost is INCOMPLETE. Missing components: ${missing.join(', ')}. These cannot be assumed 0.`,
    );
  }

  return add(
    input.supplierBaseCost,
    input.inboundLogistics!,
    input.importDutiesTariffs!,
    input.valueAddedTax!,
    input.customsClearance!,
    input.supplierPaymentProcessingFee!,
    input.inboundPackagingMaterials!,
    input.qualityInspectionCost!,
    input.wastageAndDefectReserve!,
    input.handlingWarehousingInbound!,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFIT ENGINE (Primary)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfitEngineInput {
  realisticSellingPrice: Decimal;
  landedCost: Decimal;
  marketplaceTotalCost: Decimal;
  operationalCapitalAllocated?: Decimal;
  /**
   * Raw landed-cost components for genuinely independent Engine-B reconstruction.
   * When provided, Engine B re-sums these from scratch (distrusting the
   * pre-aggregated `landedCost`), which catches aggregation bugs such as a
   * dropped/zeroed component.  This is the independence IDEA.md §24 / AUDIT §21
   * require — NOT merely rearranging `A - (B + C)` into `(A - B) - C`.
   */
  landedCostComponents?: LandedCostInput;
  /**
   * Raw marketplace-fee components + selling price for Engine-B fee
   * reconstruction.  When provided, Engine B re-applies the fee rates to the
   * selling price independently (distrusting the pre-aggregated
   * `marketplaceTotalCost`).
   */
  marketplaceFeeComponents?: MarketplaceFeeReconstructionInput;
}

/**
 * Raw marketplace-fee fields needed for independent Engine-B reconstruction.
 * Mirrors the FeeConfigModel fields used by `computeMarketplaceTotalCost` so
 * Engine B can rebuild the marketplace cost from scratch.
 */
export interface MarketplaceFeeReconstructionInput {
  sellingPrice: Decimal;
  commissionRate: number | null;
  transactionFeeRate: number | null;
  paymentFeeRate: number | null;
  affiliateFeeRate: number | null;
  sellerVoucherCostRate: number | null;
  campaignFee: number | null;
  freeShippingSubsidyCost: number | null;
  allocatedAdSpendPerUnit: number | null;
  outboundPackagingCost: number | null;
  returnRefundLossProvision: number | null;
  operationalHandlingCost: number | null;
}

export interface ProfitResult {
  netProfitPerUnit: Decimal;
  netMarginPercent: Decimal;
  roiPercent: Decimal;
  breakEvenPrice: Decimal;
  markupPercent: Decimal;
  profitPerUnitRp: string;
  marginPercentFormatted: string;
  roiPercentFormatted: string;
}

export function computeProfit(input: ProfitEngineInput): ProfitResult {
  const totalCost = add(input.landedCost, input.marketplaceTotalCost);
  const netProfit = sub(input.realisticSellingPrice, totalCost);

  // Margin = profit / revenue — guard against zero revenue
  let netMargin: Decimal;
  try {
    netMargin = pct(netProfit, input.realisticSellingPrice);
  } catch (e) {
    if (e instanceof DivisionByZeroError) {
      netMargin = ZERO; // margin undefined when revenue is zero — record as 0 with warning
    } else {
      throw e;
    }
  }

  const capitalDenominator = input.operationalCapitalAllocated
    ? add(input.landedCost, input.operationalCapitalAllocated)
    : input.landedCost;

  // ROI = profit / capital — guard against zero capital
  let roi: Decimal;
  try {
    roi = pct(netProfit, capitalDenominator);
  } catch (e) {
    if (e instanceof DivisionByZeroError) {
      roi = ZERO;
    } else {
      throw e;
    }
  }

  const breakEven = totalCost;

  // Markup = (selling - landed) / landed — guard against zero landed cost
  let markup: Decimal;
  try {
    markup = pct(sub(input.realisticSellingPrice, input.landedCost), input.landedCost);
  } catch (e) {
    if (e instanceof DivisionByZeroError) {
      markup = ZERO;
    } else {
      throw e;
    }
  }

  return {
    netProfitPerUnit: netProfit,
    netMarginPercent: round4(netMargin),
    roiPercent: round4(roi),
    breakEvenPrice: breakEven,
    markupPercent: round4(markup),
    profitPerUnitRp: formatRp(netProfit),
    marginPercentFormatted: `${round4(netMargin).toFixed(2)}%`,
    roiPercentFormatted: `${round4(roi).toFixed(2)}%`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFIT ENGINE (Validator — INDEPENDENT reconstruction)
// ─────────────────────────────────────────────────────────────────────────────
//
// IDEA.md §24 / AUDIT §21 explicitly forbid an algebraically-identical
// "validator" — `(A-B)-C` is the same as `A-(B+C)`.  The previous
// implementation did exactly that, so it was NOT_INDEPENDENT.
//
// This Engine B uses a GENUINELY DIFFERENT calculation path:
//
//   1. Distrust the pre-aggregated `landedCost` and re-sum the raw
//      cost components from scratch.  If an aggregation bug dropped a
//      component (e.g. customs zeroed), Engine A would use the wrong
//      total while Engine B rebuilds correctly — the mismatch is caught.
//   2. Distrust the pre-aggregated `marketplaceTotalCost` and re-apply
//      every fee rate/flat to the selling price independently.
//   3. Compute profit via a different algebraic structure:
//        netRevenue = sellingPrice - marketplaceCostReconstructed
//        netCost    = landedCostReconstructed
//        profitB    = netRevenue - netCost
//   4. Cross-validate the reconstructed aggregates against the
//      pre-aggregated values (catches aggregation corruption).
//   5. Reconcile profitB against Engine A's profit.
//
// When raw components are NOT supplied, Engine B cannot reconstruct
// independently and returns `independent: false` with the weak algebraic
// fallback — callers MUST treat that as reduced assurance (NOT_INDEPENDENT).

export interface IndependentValidatorResult {
  netProfit: Decimal;
  /** true only when Engine B reconstructed from raw components (genuine independence) */
  independent: boolean;
  /** Description of the validation path actually used. */
  method: string;
  /** Reconstructed landed cost (null when components not supplied) */
  reconstructedLandedCost: Decimal | null;
  /** Reconstructed marketplace cost (null when components not supplied) */
  reconstructedMarketplaceCost: Decimal | null;
  /** Cross-validation of reconstructed vs pre-aggregated landed cost */
  landedCostAgreement: boolean | null;
  /** Cross-validation of reconstructed vs pre-aggregated marketplace cost */
  marketplaceCostAgreement: boolean | null;
}

export function computeProfitValidator(input: ProfitEngineInput): Decimal {
  return computeProfitIndependent(input).netProfit;
}

/**
 * Engine B — independent bottom-up reconstruction.
 *
 * Returns the independently-reconstructed net profit plus metadata about
 * whether genuine independence was achieved.
 */
export function computeProfitIndependent(input: ProfitEngineInput): IndependentValidatorResult {
  const hasLandedComponents = !!input.landedCostComponents;
  const hasFeeComponents = !!input.marketplaceFeeComponents;

  // ── Path 1: genuine independence — reconstruct both aggregates from raw ──
  if (hasLandedComponents && hasFeeComponents) {
    const comps = input.landedCostComponents!;
    const feeComps = input.marketplaceFeeComponents!;

    // Re-sum landed cost components from scratch (independent re-aggregation).
    const landedReconstructed = recomputeLandedCost(comps);

    // Re-apply marketplace fees to the selling price from scratch.
    const marketplaceReconstructed = recomputeMarketplaceCost(feeComps);

    // Cross-validate the reconstructed aggregates against the pre-aggregated
    // values that Engine A consumed.  A mismatch means the aggregation step
    // (computeLandedCost / computeMarketplaceTotalCost) corrupted a component.
    const landedAgrees = valuesAgree(landedReconstructed, input.landedCost);
    const marketplaceAgrees = valuesAgree(marketplaceReconstructed, input.marketplaceTotalCost);

    // Independent profit via a different algebraic structure:
    //   netRevenue = sellingPrice - marketplaceCost
    //   profitB     = netRevenue - landedCost
    // (Engine A did: profit = sellingPrice - (landedCost + marketplaceCost))
    const netRevenue = sub(input.realisticSellingPrice, marketplaceReconstructed);
    const netProfitB = sub(netRevenue, landedReconstructed);

    // If reconstructed aggregates disagree with the pre-aggregated ones, the
    // reconciliation in calculateProfitWithValidation will catch the divergence.
    return {
      netProfit: netProfitB,
      independent: true,
      method: 'INDEPENDENT_COMPONENT_RECONSTRUCTION (bottom-up re-sum of landed-cost components + independent fee re-application)',
      reconstructedLandedCost: landedReconstructed,
      reconstructedMarketplaceCost: marketplaceReconstructed,
      landedCostAgreement: landedAgrees,
      marketplaceCostAgreement: marketplaceAgrees,
    };
  }

  // ── Path 2: partial independence — only landed-cost components supplied ──
  if (hasLandedComponents) {
    const comps = input.landedCostComponents!;
    const landedReconstructed = recomputeLandedCost(comps);
    const landedAgrees = valuesAgree(landedReconstructed, input.landedCost);
    // Marketplace cost still trusted from Engine A (not independently rebuilt)
    const netRevenue = sub(input.realisticSellingPrice, input.marketplaceTotalCost);
    const netProfitB = sub(netRevenue, landedReconstructed);
    return {
      netProfit: netProfitB,
      independent: false,
      method: 'PARTIAL — landed-cost reconstructed independently; marketplace cost trusted from Engine A (NOT_INDEPENDENT for fees)',
      reconstructedLandedCost: landedReconstructed,
      reconstructedMarketplaceCost: null,
      landedCostAgreement: landedAgrees,
      marketplaceCostAgreement: null,
    };
  }

  // ── Path 3: weak fallback — algebraically identical (NOT_INDEPENDENT) ──
  // This path exists only for backward compatibility with callers that do
  // not yet supply raw components.  It MUST be reported as NOT_INDEPENDENT.
  const afterFees = sub(input.realisticSellingPrice, input.marketplaceTotalCost);
  const netProfitFallback = sub(afterFees, input.landedCost);
  return {
    netProfit: netProfitFallback,
    independent: false,
    method: 'NOT_INDEPENDENT — algebraically identical fallback (A-B)-C; raw components not supplied',
    reconstructedLandedCost: null,
    reconstructedMarketplaceCost: null,
    landedCostAgreement: null,
    marketplaceCostAgreement: null,
  };
}

/**
 * Independently re-sum landed-cost components.  Throws UncalculatedCostException
 * if any required component is null — mirroring computeLandedCost but called
 * independently so that a bug in the original aggregation is detectable.
 */
function recomputeLandedCost(comps: LandedCostInput): Decimal {
  const missing: string[] = [];
  for (const key of REQUIRED_LANDED_COST_COMPONENTS) {
    const val = (comps as unknown as { [k: string]: Decimal | null })[key];
    if (val === null || val === undefined) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new UncalculatedCostException(
      `[Engine B] Landed cost reconstruction INCOMPLETE. Missing: ${missing.join(', ')}.`,
    );
  }
  return add(
    comps.supplierBaseCost,
    comps.inboundLogistics!,
    comps.importDutiesTariffs!,
    comps.valueAddedTax!,
    comps.customsClearance!,
    comps.supplierPaymentProcessingFee!,
    comps.inboundPackagingMaterials!,
    comps.qualityInspectionCost!,
    comps.wastageAndDefectReserve!,
    comps.handlingWarehousingInbound!,
  );
}

/**
 * Independently re-apply marketplace fee rates/flats to the selling price.
 * Mirrors computeMarketplaceTotalCost logic but called independently.
 */
function recomputeMarketplaceCost(f: MarketplaceFeeReconstructionInput): Decimal {
  const components: Decimal[] = [];
  const selling = f.sellingPrice.abs();

  const applyRate = (rate: number | null, label: string): void => {
    if (rate === null || rate === undefined) {
      throw new CalculationConflictError(`[Engine B] Missing fee '${label}' — cannot reconstruct marketplace cost independently`);
    }
    components.push(selling.times(rate));
  };
  const applyFlat = (value: number | null, label: string): void => {
    if (value === null || value === undefined) {
      throw new CalculationConflictError(`[Engine B] Missing flat fee '${label}' — cannot reconstruct marketplace cost independently`);
    }
    components.push(D(value));
  };

  applyRate(f.commissionRate, 'commissionRate');
  applyRate(f.transactionFeeRate, 'transactionFeeRate');
  applyRate(f.paymentFeeRate, 'paymentFeeRate');
  applyRate(f.affiliateFeeRate, 'affiliateFeeRate');
  applyRate(f.sellerVoucherCostRate, 'sellerVoucherCostRate');
  applyFlat(f.campaignFee, 'campaignFee');
  applyFlat(f.freeShippingSubsidyCost, 'freeShippingSubsidyCost');
  applyFlat(f.allocatedAdSpendPerUnit, 'allocatedAdSpendPerUnit');
  applyFlat(f.outboundPackagingCost, 'outboundPackagingCost');
  applyFlat(f.returnRefundLossProvision, 'returnRefundLossProvision');
  applyFlat(f.operationalHandlingCost, 'operationalHandlingCost');

  return components.reduce((sum, c) => sum.plus(c), ZERO);
}
function valuesAgree(a: Decimal, b: Decimal): boolean {
  try {
    validateReconciliation(a, b);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL PROFIT CALCULATION WITH DOUBLE-ENTRY VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

export interface FullProfitCalculation {
  primaryResult: ProfitResult;
  validatorNetProfit: Decimal;
  reconciled: boolean;
  confidence: number;
  /** Whether Engine B achieved genuine independence (reconstructed from raw components). */
  independentValidation: boolean;
  /** Human-readable description of the Engine-B validation path used. */
  validationMethod: string;
  /** Cross-validation flags from Engine B (null when not applicable). */
  landedCostAgreement: boolean | null;
  marketplaceCostAgreement: boolean | null;
  scenarios?: ScenarioResult[];
  sensitivity?: SensitivityMatrix;
}

export function calculateProfitWithValidation(
  input: ProfitEngineInput,
): FullProfitCalculation {
  const primaryResult = computeProfit(input);
  const validatorResult = computeProfitIndependent(input);

  let reconciled = true;
  try {
    validateReconciliation(primaryResult.netProfitPerUnit, validatorResult.netProfit);
  } catch (e) {
    if (e instanceof CalculationConflictError) {
      reconciled = false;
    } else {
      throw e;
    }
  }

  // If the reconstructed aggregates disagree with the pre-aggregated values,
  // the reconciliation is failed even if the final profit happens to match
  // (a dropped component could coincidentally produce the same profit).
  if (validatorResult.independent) {
    if (validatorResult.landedCostAgreement === false || validatorResult.marketplaceCostAgreement === false) {
      reconciled = false;
    }
  }

  return {
    primaryResult,
    validatorNetProfit: validatorResult.netProfit,
    reconciled,
    confidence: reconciled ? (validatorResult.independent ? 1.0 : 0.7) : 0.5,
    independentValidation: validatorResult.independent,
    validationMethod: validatorResult.method,
    landedCostAgreement: validatorResult.landedCostAgreement,
    marketplaceCostAgreement: validatorResult.marketplaceCostAgreement,
    scenarios: runScenarios(input),
    sensitivity: buildSensitivityMatrix(input),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO ENGINE (Bear / Base / Bull)
// ─────────────────────────────────────────────────────────────────────────────

export interface ScenarioModifiers {
  sellingPriceShift: number;
  supplierCostShift: number;
  marketplaceFeeShift: number;
  logisticsShift: number;
  returnRateShift: number;
}

export interface ScenarioResult {
  scenario: 'BEAR' | 'BASE' | 'BULL';
  netProfit: Decimal;
  netMargin: Decimal;
  roi: Decimal;
  label: string;
}

export function runScenario(
  baseInput: ProfitEngineInput,
  modifiers: ScenarioModifiers,
  scenarioName: 'BEAR' | 'BASE' | 'BULL',
): ScenarioResult {
  const shiftedSellingPrice = baseInput.realisticSellingPrice.times(1 + modifiers.sellingPriceShift);
  const shiftedLandedCost = baseInput.landedCost.times(1 + modifiers.supplierCostShift);
  const shiftedMarketplaceCost = baseInput.marketplaceTotalCost.times(1 + modifiers.marketplaceFeeShift);

  const shiftedInput: ProfitEngineInput = {
    realisticSellingPrice: shiftedSellingPrice,
    landedCost: shiftedLandedCost,
    marketplaceTotalCost: shiftedMarketplaceCost,
    operationalCapitalAllocated: baseInput.operationalCapitalAllocated,
  };

  const result = computeProfit(shiftedInput);

  return {
    scenario: scenarioName,
    netProfit: result.netProfitPerUnit,
    netMargin: result.netMarginPercent,
    roi: result.roiPercent,
    label: `${scenarioName}: Profit ${formatRp(result.netProfitPerUnit)}, Margin ${result.marginPercentFormatted}, ROI ${result.roiPercentFormatted}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO RUNNER (Bear / Base / Bull)
// ─────────────────────────────────────────────────────────────────────────────
//
// IDEA.xml §30:
//   BEAR  — lower selling price, higher supplier cost, higher fees,
//           higher logistics, lower demand, higher ad spend.
//   BASE  — most realistic observed assumptions (no shift).
//   BULL  — favorable but plausible assumptions.
//
// These modifiers are deliberately conservative so that the BEAR scenario
// represents a genuine downside stress, not a cosmetic shift.

const SCENARIO_MODIFIERS: Record<'BEAR' | 'BASE' | 'BULL', ScenarioModifiers> = {
  BEAR: {
    sellingPriceShift: -0.10,   // -10% selling price
    supplierCostShift: 0.10,   // +10% supplier cost
    marketplaceFeeShift: 0.05, // +5% fees
    logisticsShift: 0.15,      // +15% logistics
    returnRateShift: 0.05,     // +5% returns
  },
  BASE: {
    sellingPriceShift: 0,
    supplierCostShift: 0,
    marketplaceFeeShift: 0,
    logisticsShift: 0,
    returnRateShift: 0,
  },
  BULL: {
    sellingPriceShift: 0.10,   // +10% selling price
    supplierCostShift: -0.05,  // -5% supplier cost
    marketplaceFeeShift: 0,    // fees unchanged
    logisticsShift: -0.05,    // -5% logistics
    returnRateShift: -0.02,   // -2% returns
  },
};

export function runScenarios(baseInput: ProfitEngineInput): ScenarioResult[] {
  return (['BEAR', 'BASE', 'BULL'] as const).map((name) =>
    runScenario(baseInput, SCENARIO_MODIFIERS[name], name),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SENSITIVITY MATRIX
// ─────────────────────────────────────────────────────────────────────────────

export interface SensitivityCell {
  sellingPriceShift: number;
  supplierCostShift: number;
  netProfit: Decimal;
  netMargin: Decimal;
  isProfitable: boolean;
}

export interface SensitivityMatrix {
  cells: SensitivityCell[][];
  sellingPriceShifts: number[];
  supplierCostShifts: number[];
  robustnessRating: 'VERY_FRAGILE' | 'FRAGILE' | 'MODERATE' | 'ROBUST' | 'VERY_ROBUST';
}

export function buildSensitivityMatrix(
  baseInput: ProfitEngineInput,
  sellingPriceShifts: number[] = [-0.2, -0.1, 0, 0.1, 0.2],
  supplierCostShifts: number[] = [-0.2, -0.1, 0, 0.1, 0.2],
): SensitivityMatrix {
  const cells: SensitivityCell[][] = [];
  let profitableCount = 0;
  const totalCells = sellingPriceShifts.length * supplierCostShifts.length;

  for (const spShift of sellingPriceShifts) {
    const row: SensitivityCell[] = [];
    for (const scShift of supplierCostShifts) {
      const shiftedSelling = baseInput.realisticSellingPrice.times(1 + spShift);
      const shiftedLanded = baseInput.landedCost.times(1 + scShift);
      const shiftedInput: ProfitEngineInput = {
        realisticSellingPrice: shiftedSelling,
        landedCost: shiftedLanded,
        marketplaceTotalCost: baseInput.marketplaceTotalCost,
      };

      const profitResult = computeProfit(shiftedInput);
      const isProfitable = profitResult.netProfitPerUnit.gt(ZERO);
      if (isProfitable) profitableCount++;

      row.push({
        sellingPriceShift: spShift,
        supplierCostShift: scShift,
        netProfit: profitResult.netProfitPerUnit,
        netMargin: profitResult.netMarginPercent,
        isProfitable,
      });
    }
    cells.push(row);
  }

  const profitableFraction = profitableCount / totalCells;
  let robustnessRating: SensitivityMatrix['robustnessRating'];
  if (profitableFraction >= 0.95) robustnessRating = 'VERY_ROBUST';
  else if (profitableFraction >= 0.80) robustnessRating = 'ROBUST';
  else if (profitableFraction >= 0.60) robustnessRating = 'MODERATE';
  else if (profitableFraction >= 0.30) robustnessRating = 'FRAGILE';
  else robustnessRating = 'VERY_FRAGILE';

  return { cells, sellingPriceShifts, supplierCostShifts, robustnessRating };
}
