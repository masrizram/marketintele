import { attributeOutcomes, aggregateModelMetrics, PredictionVsActual } from './learning';

describe('Closed-Loop Learning — attribution (IDEA §32)', () => {
  it('attributes supplier cost error', () => {
    const pva: PredictionVsActual = {
      predictedSupplierCost: 50000,
      actualSupplierCost: 60000,
      predictedMarketPrice: 100000,
      actualMarketPrice: 100000,
      predictedDemand: null,
      actualDemand: null,
      predictedShipping: 5000,
      actualShipping: 5000,
      predictedFee: 10000,
      actualFee: 10000,
      predictedReturnRate: 0.02,
      actualReturnRate: 0.02,
      predictedProfit: 20000,
      actualProfit: 10000,
      capitalAllocated: 70000,
    };
    const result = attributeOutcomes('opp_1', pva);
    const supplierFinding = result.attributions.find((f) => f.field === 'supplier_cost');
    expect(supplierFinding).toBeDefined();
    expect(supplierFinding!.category).toBe('SUPPLIER_ERROR');
    // actual(60000) - predicted(50000) = 10000 error, cost component → impact = -10000
    expect(supplierFinding!.error).toBe(10000);
    expect(supplierFinding!.impact).toBe(-10000);
  });

  it('computes total prediction error = predicted - actual profit', () => {
    const pva: PredictionVsActual = {
      predictedSupplierCost: 50000, actualSupplierCost: 50000,
      predictedMarketPrice: 100000, actualMarketPrice: 90000, // -10000 revenue
      predictedDemand: null, actualDemand: null,
      predictedShipping: 5000, actualShipping: 5000,
      predictedFee: 10000, actualFee: 10000,
      predictedReturnRate: 0.02, actualReturnRate: 0.02,
      predictedProfit: 20000,
      actualProfit: 10000, // 10000 less than predicted
      capitalAllocated: 70000,
    };
    const result = attributeOutcomes('opp_1', pva);
    expect(result.totalPredictionError).toBe(10000); // predicted(20000) - actual(10000)
    expect(result.bias).toBe('OVERESTIMATE');
  });

  it('flags LANDED_COST_OMISSION when actual is missing', () => {
    const pva: PredictionVsActual = {
      predictedSupplierCost: 50000,
      actualSupplierCost: null, // actual missing → omission
      predictedMarketPrice: 100000, actualMarketPrice: 100000,
      predictedDemand: null, actualDemand: null,
      predictedShipping: 5000, actualShipping: 5000,
      predictedFee: 10000, actualFee: 10000,
      predictedReturnRate: 0.02, actualReturnRate: 0.02,
      predictedProfit: 20000, actualProfit: 20000,
      capitalAllocated: 70000,
    };
    const result = attributeOutcomes('opp_1', pva);
    const omission = result.attributions.find((f) => f.category === 'LANDED_COST_OMISSION');
    expect(omission).toBeDefined();
    expect(omission!.actual).toBeNull();
  });

  it('computes realized risk-adjusted profit', () => {
    const pva: PredictionVsActual = {
      predictedSupplierCost: 50000, actualSupplierCost: 50000,
      predictedMarketPrice: 100000, actualMarketPrice: 100000,
      predictedDemand: null, actualDemand: null,
      predictedShipping: 5000, actualShipping: 5000,
      predictedFee: 10000, actualFee: 10000,
      predictedReturnRate: 0.02, actualReturnRate: 0.02,
      predictedProfit: 20000, actualProfit: 20000,
      capitalAllocated: 70000,
    };
    const result = attributeOutcomes('opp_1', pva);
    // risk-adjusted = actual_profit / capital = 20000 / 70000
    expect(result.realizedRiskAdjustedProfit).toBeCloseTo(20000 / 70000, 3);
  });

  it('returns ACCURATE when prediction matches actual', () => {
    const pva: PredictionVsActual = {
      predictedSupplierCost: 50000, actualSupplierCost: 50000,
      predictedMarketPrice: 100000, actualMarketPrice: 100000,
      predictedDemand: null, actualDemand: null,
      predictedShipping: 5000, actualShipping: 5000,
      predictedFee: 10000, actualFee: 10000,
      predictedReturnRate: 0.02, actualReturnRate: 0.02,
      predictedProfit: 20000, actualProfit: 20000,
      capitalAllocated: 70000,
    };
    const result = attributeOutcomes('opp_1', pva);
    expect(result.bias).toBe('ACCURATE');
  });
});

describe('Closed-Loop Learning — aggregateModelMetrics', () => {
  it('aggregates MAE and MAPE across opportunities', () => {
    const pva1: PredictionVsActual = {
      predictedSupplierCost: 50000, actualSupplierCost: 50000,
      predictedMarketPrice: 100000, actualMarketPrice: 100000,
      predictedDemand: null, actualDemand: null,
      predictedShipping: 5000, actualShipping: 5000,
      predictedFee: 10000, actualFee: 10000,
      predictedReturnRate: 0.02, actualReturnRate: 0.02,
      predictedProfit: 20000, actualProfit: 15000,
      capitalAllocated: 70000,
    };
    const pva2: PredictionVsActual = {
      ...pva1,
      predictedProfit: 30000, actualProfit: 35000, // underpredict
    };
    const r1 = attributeOutcomes('opp_1', pva1);
    const r2 = attributeOutcomes('opp_2', pva2);
    const metrics = aggregateModelMetrics([r1, r2]);
    expect(metrics.sampleSize).toBe(2);
    expect(metrics.meanAbsoluteError).not.toBeNull();
    expect(metrics.meanAbsolutePercentageError).not.toBeNull();
  });

  it('returns UNKNOWN for empty results', () => {
    const metrics = aggregateModelMetrics([]);
    expect(metrics.sampleSize).toBe(0);
    expect(metrics.meanAbsoluteError).toBeNull();
    expect(metrics.bias).toBe('UNKNOWN');
  });
});
