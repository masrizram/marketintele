import Decimal from 'decimal.js';
import { D, add, sub, mul, div, percentage, round4, validateReconciliation, DivisionByZeroError, CalculationConflictError } from './decimal-engine';
import { computeProfit, computeProfitValidator, calculateProfitWithValidation, runScenario, computeLandedCost } from './profit-engine';
import { UncalculatedCostException } from './decimal-engine';

// ─────────────────────────────────────────────────────────────────────────────
// IDEA.xml §96 — Property-based financial invariants:
//   profit = revenue - all_costs
//   margin = profit / revenue
//   ROI = profit / capital
//
// These tests ensure the decimal engine is deterministic and correct for all
// edge cases specified in IDEA.xml §96.
// ─────────────────────────────────────────────────────────────────────────────

describe('Decimal Engine — D() constructor', () => {
  it('accepts a finite number', () => {
    expect(D(100).toString()).toBe('100');
  });

  it('accepts a numeric string', () => {
    expect(D('99.99').toString()).toBe('99.99');
  });

  it('accepts a bigint (via conversion to string)', () => {
    const bigVal = BigInt(1000000);
    const decimalVal = D(bigVal.toString());
    expect(decimalVal.toString()).toBe('1000000');
  });

  it('accepts an existing Decimal (pass-through)', () => {
    const d = new Decimal('123.456');
    expect(D(d).toString()).toBe('123.456');
  });

  it('THROWS on NaN', () => {
    expect(() => D(NaN)).toThrow('non-finite');
  });

  it('THROWS on Infinity', () => {
    expect(() => D(Infinity)).toThrow('non-finite');
  });

  it('THROWS on -Infinity', () => {
    expect(() => D(-Infinity)).toThrow('non-finite');
  });
});

describe('Decimal Engine — add/sub/mul/div', () => {
  it('adds two decimals', () => {
    expect(add(D(10), D(20)).toString()).toBe('30');
  });

  it('multiplies two decimals', () => {
    expect(mul(D(10), D(3)).toString()).toBe('30');
  });

  it('divides two decimals', () => {
    expect(div(D(10), D(4)).toString()).toBe('2.5');
  });

  it('subtracts two decimals', () => {
    expect(sub(D(100), D(30)).toString()).toBe('70');
  });

  it('handles multiple args in add', () => {
    expect(add(D(1), D(2), D(3), D(4)).toString()).toBe('10');
  });
});

describe('Decimal Engine — percentage', () => {
  it('computes percentage correctly (returns percentage value, not fraction)', () => {
    // 30 / 100 * 100 = 30%
    expect(percentage(D(30), D(100)).toString()).toBe('30');
  });

  it('handles negative numerator', () => {
    // -50 / 100 * 100 = -50%
    expect(percentage(D(-50), D(100)).toString()).toBe('-50');
  });
});

describe('Decimal Engine — validateReconciliation', () => {
  it('does NOT throw when values match within tolerance (1 IDR)', () => {
    expect(() => validateReconciliation(D(100), D(100))).not.toThrow();
  });

  it('does NOT throw when values differ by < 1 IDR', () => {
    expect(() => validateReconciliation(D(100.49), D(100.50))).not.toThrow();
  });

  it('THROWS CalculationConflictError when values diverge beyond 1 IDR', () => {
    expect(() => validateReconciliation(D(100), D(102))).toThrow(CalculationConflictError);
  });
});

describe('Decimal Engine — round4', () => {
  it('rounds to 4 decimal places', () => {
    expect(round4(D('1.23456')).toString()).toBe('1.2346');
  });

  it('rounds down correctly', () => {
    expect(round4(D('1.23444')).toString()).toBe('1.2344');
  });
});

describe('Decimal Engine — div', () => {
  it('THROWS DivisionByZeroError when dividing by zero', () => {
    expect(() => div(D(10), D(0))).toThrow(DivisionByZeroError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profit Engine — financial invariants (IDEA.xml §96, §106, §123)
// ─────────────────────────────────────────────────────────────────────────────

describe('Profit Engine — core invariants', () => {
  const input = {
    realisticSellingPrice: D(100000),
    landedCost: D(60000),
    marketplaceTotalCost: D(20000),
    operationalCapitalAllocated: undefined,
  };

  it('profit = revenue - all_costs', () => {
    const result = computeProfit(input);
    // Revenue(100000) - LandedCost(60000) - MarketplaceCost(20000) = 20000
    // profit = 20000
    expect(result.netProfitPerUnit.toString()).toBe('20000');
  });

  it('margin = profit / revenue (as percentage value)', () => {
    const result = computeProfit(input);
    // 20000 / 100000 * 100 = 20%
    expect(result.netMarginPercent.toString()).toBe('20');
  });

  it('ROI = profit / capital (landed cost as capital denominator)', () => {
    const result = computeProfit(input);
    // 20000 / 60000 * 100 = 33.3333%
    expect(result.roiPercent.toString()).toBe('33.3333');
  });

  it('breakEvenPrice = totalCost', () => {
    const result = computeProfit(input);
    expect(result.breakEvenPrice.toString()).toBe('80000');
  });

  it('markup = (selling - landed) / landed (as percentage)', () => {
    const result = computeProfit(input);
    // (100000 - 60000) / 60000 * 100 = 66.6667%
    expect(result.markupPercent.toString()).toBe('66.6667');
  });
});

describe('Profit Engine — double-entry validation (IDEA.xml §103)', () => {
  const input = {
    realisticSellingPrice: D(100000),
    landedCost: D(60000),
    marketplaceTotalCost: D(20000),
  };

  it('calculateProfitWithValidation reconciles both engines', () => {
    const result = calculateProfitWithValidation(input);
    expect(result.reconciled).toBe(true);
    // Without raw components, Engine B falls back to the algebraically-identical
    // path — confidence is REDUCED to 0.7 (NOT_INDEPENDENT) per IDEA §24.
    expect(result.independentValidation).toBe(false);
    expect(result.confidence).toBe(0.7);
  });

  it('validator produces same net profit as primary engine (weak fallback)', () => {
    const primary = computeProfit(input);
    const validatorProfit = computeProfitValidator(input);
    expect(validatorProfit.toString()).toBe(primary.netProfitPerUnit.toString());
  });
});

describe('Profit Engine — GENUINELY INDEPENDENT validation (IDEA §24 / AUDIT §21)', () => {
  // When raw cost components + fee components are supplied, Engine B rebuilds
  // landed cost and marketplace fees from scratch — catching aggregation bugs.
  const supplierBaseCost = D(50000);
  const landedCostComponents = {
    supplierBaseCost,
    inboundLogistics: D(5000),
    importDutiesTariffs: D(0),
    valueAddedTax: D(5500),
    customsClearance: D(500),
    supplierPaymentProcessingFee: D(250),
    inboundPackagingMaterials: D(300),
    qualityInspectionCost: D(1000),
    wastageAndDefectReserve: D(2500),
    handlingWarehousingInbound: D(2000),
  };
  // landed = 50000+5000+0+5500+500+250+300+1000+2500+2000 = 67050
  const landedCost = D(67050);
  // marketplace fees: commission 2% of 100000=2000, transaction 1%=1000, payment 2.9%=2900,
  // affiliate 0, voucher 0, campaign 0, freeship 0, ad 0, packaging 0, returns 0, handling 0 = 5900
  const marketplaceTotalCost = D(5900);
  const sellingPrice = D(100000);
  const marketplaceFeeComponents = {
    sellingPrice: sellingPrice,
    commissionRate: 0.02,
    transactionFeeRate: 0.01,
    paymentFeeRate: 0.029,
    affiliateFeeRate: 0,
    sellerVoucherCostRate: 0,
    campaignFee: 0,
    freeShippingSubsidyCost: 0,
    allocatedAdSpendPerUnit: 0,
    outboundPackagingCost: 0,
    returnRefundLossProvision: 0,
    operationalHandlingCost: 0,
  };

  const inputWithComponents = {
    realisticSellingPrice: sellingPrice,
    landedCost,
    marketplaceTotalCost,
    landedCostComponents,
    marketplaceFeeComponents,
  };

  it('Engine B is genuinely independent when raw components are supplied', () => {
    const result = calculateProfitWithValidation(inputWithComponents);
    expect(result.independentValidation).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it('Engine B reconstructs landed cost matching the pre-aggregated value', () => {
    const result = calculateProfitWithValidation(inputWithComponents);
    expect(result.landedCostAgreement).toBe(true);
    expect(result.marketplaceCostAgreement).toBe(true);
  });

  it('Engine B DETECTS a corrupted landed-cost aggregation (dropped component)', () => {
    // Give Engine A a WRONG landedCost (customs dropped) while Engine B
    // rebuilds correctly from the full components — the mismatch must be caught.
    const corruptedInput = {
      ...inputWithComponents,
      landedCost: D(66550), // 67050 - 500 (customs dropped) = WRONG aggregate
    };
    const result = calculateProfitWithValidation(corruptedInput);
    // Reconstructed landed cost disagrees with the corrupted pre-aggregate
    expect(result.landedCostAgreement).toBe(false);
    expect(result.reconciled).toBe(false);
  });

  it('Engine B DETECTS a corrupted marketplace-fee aggregation', () => {
    const corruptedInput = {
      ...inputWithComponents,
      marketplaceTotalCost: D(5800), // wrong by 100
    };
    const result = calculateProfitWithValidation(corruptedInput);
    expect(result.marketplaceCostAgreement).toBe(false);
    expect(result.reconciled).toBe(false);
  });
});

describe('Profit Engine — edge cases (IDEA.xml §96)', () => {
  it('handles zero landed cost (markup returns 0 gracefully)', () => {
    const input = {
      realisticSellingPrice: D(100000),
      landedCost: D(0),
      marketplaceTotalCost: D(20000),
    };
    const result = computeProfit(input);
    expect(result.netProfitPerUnit.toString()).toBe('80000');
    // With zero landed cost, markup is undefined — engine returns 0 instead of throwing
    expect(result.markupPercent.toString()).toBe('0');
  });

  it('handles zero selling price (profit negative, margin/roi return 0 gracefully)', () => {
    const input = {
      realisticSellingPrice: D(0),
      landedCost: D(50000),
      marketplaceTotalCost: D(10000),
    };
    const result = computeProfit(input);
    expect(result.netProfitPerUnit.toString()).toBe('-60000');
    // With zero selling price, margin is undefined — engine returns 0 instead of throwing
    expect(result.netMarginPercent.toString()).toBe('0');
  });

  it('handles negative selling price (profit extremely negative)', () => {
    const input = {
      realisticSellingPrice: D(-1000),
      landedCost: D(50000),
      marketplaceTotalCost: D(10000),
    };
    const result = computeProfit(input);
    expect(result.netProfitPerUnit.toString()).toBe('-61000');
  });
});

describe('Landed Cost Engine — UNKNOWN != 0 invariant (IDEA.xml §3)', () => {
  it('THROWS UncalculatedCostException when any landed cost component is null', () => {
    const input = {
      supplierBaseCost: D(50000),
      inboundLogistics: null,
      importDutiesTariffs: null,
      valueAddedTax: null,
      customsClearance: null,
      supplierPaymentProcessingFee: null,
      inboundPackagingMaterials: null,
      qualityInspectionCost: null,
      wastageAndDefectReserve: null,
      handlingWarehousingInbound: null,
    };
    expect(() => computeLandedCost(input)).toThrow(UncalculatedCostException);
    expect(() => computeLandedCost(input)).toThrow('inboundLogistics');
  });

  it('computes landed cost when all components provided', () => {
    const input = {
      supplierBaseCost: D(50000),
      inboundLogistics: D(5000),
      importDutiesTariffs: D(0),
      valueAddedTax: D(5500),
      customsClearance: D(500),
      supplierPaymentProcessingFee: D(250),
      inboundPackagingMaterials: D(300),
      qualityInspectionCost: D(1000),
      wastageAndDefectReserve: D(2500),
      handlingWarehousingInbound: D(2000),
    };
    const result = computeLandedCost(input);
    // 50000 + 5000 + 0 + 5500 + 500 + 250 + 300 + 1000 + 2500 + 2000 = 67050
    expect(result.toString()).toBe('67050');
  });
});

describe('Scenario Engine — Bear/Base/Bull (IDEA.xml §48)', () => {
  const baseInput = {
    realisticSellingPrice: D(100000),
    landedCost: D(60000),
    marketplaceTotalCost: D(20000),
  };

  it('BEAR scenario reduces selling price', () => {
    const result = runScenario(baseInput, { sellingPriceShift: -0.1, supplierCostShift: 0, marketplaceFeeShift: 0, logisticsShift: 0, returnRateShift: 0 }, 'BEAR');
    // Selling price drops 10%: 100000 → 90000; profit = 90000 - 80000 = 10000
    expect(result.netProfit.toString()).toBe('10000');
  });

  it('BULL scenario increases selling price', () => {
    const result = runScenario(baseInput, { sellingPriceShift: 0.1, supplierCostShift: 0, marketplaceFeeShift: 0, logisticsShift: 0, returnRateShift: 0 }, 'BULL');
    // Selling price rises 10%: 100000 → 110000; profit = 110000 - 80000 = 30000
    expect(result.netProfit.toString()).toBe('30000');
  });

  it('BASE scenario matches original profit', () => {
    const result = runScenario(baseInput, { sellingPriceShift: 0, supplierCostShift: 0, marketplaceFeeShift: 0, logisticsShift: 0, returnRateShift: 0 }, 'BASE');
    // No shifts → same as computeProfit
    expect(result.netProfit.toString()).toBe('20000');
  });
});
