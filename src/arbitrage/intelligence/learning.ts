/**
 * Closed-Loop Profit Learning Engine
 *
 * IDEA.md §32 / AUDIT §36 require tracking prediction vs reality:
 *
 *   PREDICTED → RECOMMENDED → TESTED → ACTUAL → ATTRIBUTION → ERROR →
 *   CALIBRATION → MODEL UPDATE
 *
 * Track: predicted_supplier_cost, actual_supplier_cost, predicted_market_price,
 * actual_market_price, predicted_demand, actual_demand, predicted_shipping,
 * actual_shipping, predicted_fee, actual_fee, predicted_return_rate,
 * actual_return_rate, predicted_profit, actual_profit.
 *
 * Attribution categories: PRICE_ERROR, DEMAND_ERROR, LANDED_COST_OMISSION,
 * DEFECT_ERROR, FEE_DISCREPANCY, RETURN_ERROR, SUPPLIER_ERROR.
 *
 * Primary metric: REALIZED_RISK_ADJUSTED_PROFIT per recommended opportunity —
 * NOT prediction_accuracy alone (IDEA.md §32).
 */
import { D, round4 } from '../economic/decimal-engine';

export type AttributionCategory =
  | 'PRICE_ERROR'
  | 'DEMAND_ERROR'
  | 'LANDED_COST_OMISSION'
  | 'DEFECT_ERROR'
  | 'FEE_DISCREPANCY'
  | 'RETURN_ERROR'
  | 'SUPPLIER_ERROR'
  | 'NO_ERROR';

export interface PredictionVsActual {
  predictedSupplierCost: number | null;
  actualSupplierCost: number | null;
  predictedMarketPrice: number | null;
  actualMarketPrice: number | null;
  predictedDemand: number | null;
  actualDemand: number | null;
  predictedShipping: number | null;
  actualShipping: number | null;
  predictedFee: number | null;
  actualFee: number | null;
  predictedReturnRate: number | null;
  actualReturnRate: number | null;
  predictedProfit: number | null;
  actualProfit: number | null;
  /** Capital allocated to this opportunity (for risk-adjusted return). */
  capitalAllocated: number | null;
}

export interface AttributionFinding {
  category: AttributionCategory;
  field: string;
  predicted: number | null;
  actual: number | null;
  error: number | null;       // absolute error
  errorPct: number | null;    // percentage error (relative to predicted)
  impact: number;             // IDR impact on profit (negative = hurt profit)
  evidence: string;
}

export interface LearningResult {
  opportunityId: string;
  attributions: AttributionFinding[];
  totalPredictionError: number | null;    // predicted - actual profit
  totalPredictionErrorPct: number | null;
  realizedProfit: number | null;          // actual profit
  realizedRiskAdjustedProfit: number | null; // actual profit / capital
  predictionAccuracy: number | null;       // 1 - |error/predicted|, clamped 0-1
  bias: 'OVERESTIMATE' | 'UNDERESTIMATE' | 'ACCURATE' | 'UNKNOWN';
  methodology: string;
  evidence: string[];
  timestamp: string;
}

/**
 * Compare predicted vs actual outcomes and attribute the profit error.
 *
 * Every field that has both a predicted and actual value contributes an
 * attribution finding.  Fields with UNKNOWN actuals (null) are flagged as
 * LANDED_COST_OMISSION or the relevant omission category — never silently
 * assumed zero.
 */
export function attributeOutcomes(
  opportunityId: string,
  pva: PredictionVsActual,
): LearningResult {
  const timestamp = new Date().toISOString();
  const methodology =
    'Component-wise attribution: for each predicted-vs-actual pair, compute ' +
    'absolute error + IDR impact on profit.  Missing actuals flagged as ' +
    'omissions (UNKNOWN != ZERO).  Realized risk-adjusted profit = actual / capital.';
  const findings: AttributionFinding[] = [];
  const evidence: string[] = [];

  // Helper: attribute a single field
  const attribute = (
    category: AttributionCategory,
    field: string,
    predicted: number | null,
    actual: number | null,
    impactSign: number, // +1 if the field is a revenue component, -1 if a cost component
  ): void => {
    if (predicted === null && actual === null) return; // both unknown — skip
    if (actual === null && predicted !== null) {
      findings.push({
        category: 'LANDED_COST_OMISSION',
        field,
        predicted,
        actual: null,
        error: null,
        errorPct: null,
        impact: 0,
        evidence: `${field}: predicted=${predicted} but actual UNKNOWN — omission flagged (UNKNOWN != ZERO)`,
      });
      evidence.push(`OMISSION: ${field} predicted=${predicted}, actual UNKNOWN`);
      return;
    }
    if (predicted === null || actual === null) return;
    const error = D(actual).minus(D(predicted));
    const errorPct = predicted !== 0
      ? round4(error.div(D(Math.abs(predicted))).times(100)).toNumber()
      : null;
    // Impact on profit: for cost components, an increase hurts profit (negative impact)
    const impact = round4(error.times(D(impactSign))).toNumber();
    const cat = error.abs().gt(D(0.01)) ? category : 'NO_ERROR';
    findings.push({
      category: cat,
      field,
      predicted,
      actual,
      error: round4(error).toNumber(),
      errorPct,
      impact,
      evidence: `${field}: predicted=${predicted}, actual=${actual}, error=${round4(error).toNumber()}, impact=${impact} IDR`,
    });
  };

  // Cost components: actual > predicted hurts profit (impactSign = -1)
  attribute('SUPPLIER_ERROR', 'supplier_cost', pva.predictedSupplierCost, pva.actualSupplierCost, -1);
  attribute('PRICE_ERROR', 'market_price', pva.predictedMarketPrice, pva.actualMarketPrice, 1);
  attribute('DEMAND_ERROR', 'demand', pva.predictedDemand, pva.actualDemand, 1);
  attribute('PRICE_ERROR', 'shipping', pva.predictedShipping, pva.actualShipping, -1);
  attribute('FEE_DISCREPANCY', 'fee', pva.predictedFee, pva.actualFee, -1);
  attribute('RETURN_ERROR', 'return_rate', pva.predictedReturnRate, pva.actualReturnRate, -1);
  attribute('DEFECT_ERROR', 'defect_cost', pva.predictedProfit, pva.actualProfit, 0); // profit itself

  // Total prediction error
  let totalPredictionError: number | null = null;
  let totalPredictionErrorPct: number | null = null;
  if (pva.predictedProfit !== null && pva.actualProfit !== null) {
    totalPredictionError = round4(D(pva.predictedProfit).minus(D(pva.actualProfit))).toNumber();
    const denom = Math.abs(pva.predictedProfit);
    totalPredictionErrorPct = denom > 0
      ? round4(D(totalPredictionError).div(D(denom)).times(100)).toNumber()
      : null;
    evidence.push(`total_prediction_error = ${totalPredictionError} IDR (${totalPredictionErrorPct}%)`);
  }

  // Prediction accuracy (1 - normalised error)
  let predictionAccuracy: number | null = null;
  if (pva.predictedProfit !== null && pva.actualProfit !== null && pva.predictedProfit !== 0) {
    const relError = Math.abs(totalPredictionError! / Math.abs(pva.predictedProfit));
    predictionAccuracy = round4(D(Math.max(0, 1 - relError))).toNumber();
  }

  // Bias
  let bias: LearningResult['bias'] = 'UNKNOWN';
  if (totalPredictionError !== null) {
    if (Math.abs(totalPredictionError) < 1) bias = 'ACCURATE';
    else if (totalPredictionError > 0) bias = 'OVERESTIMATE';
    else bias = 'UNDERESTIMATE';
  }

  // Realized risk-adjusted profit
  let realizedRiskAdjustedProfit: number | null = null;
  if (pva.actualProfit !== null && pva.capitalAllocated !== null && pva.capitalAllocated > 0) {
    realizedRiskAdjustedProfit = round4(D(pva.actualProfit).div(D(pva.capitalAllocated))).toNumber();
    evidence.push(`realized_risk_adjusted_profit = ${pva.actualProfit} / ${pva.capitalAllocated} = ${realizedRiskAdjustedProfit}`);
  } else if (pva.actualProfit !== null) {
    realizedRiskAdjustedProfit = pva.actualProfit;
    evidence.push(`realized_profit = ${pva.actualProfit} (capital unknown — not risk-adjusted)`);
  }

  // Filter out NO_ERROR findings from the returned list for clarity,
  // but keep them in evidence.
  const significantFindings = findings.filter((f) => f.category !== 'NO_ERROR');

  return {
    opportunityId,
    attributions: significantFindings.length > 0 ? significantFindings : findings,
    totalPredictionError,
    totalPredictionErrorPct,
    realizedProfit: pva.actualProfit,
    realizedRiskAdjustedProfit,
    predictionAccuracy,
    bias,
    methodology,
    evidence,
    timestamp,
  };
}

/**
 * Aggregate learning results across multiple opportunities to produce
 * model-level metrics (MAE, MAPE, bias direction).
 */
export interface ModelMetrics {
  sampleSize: number;
  meanAbsoluteError: number | null;   // MAE of profit prediction
  meanAbsolutePercentageError: number | null; // MAPE
  bias: 'OVERESTIMATE' | 'UNDERESTIMATE' | 'ACCURATE' | 'UNKNOWN';
  overestimateRate: number | null;    // fraction of opportunities where predicted > actual
  averageRealizedRiskAdjustedProfit: number | null;
}

export function aggregateModelMetrics(results: LearningResult[]): ModelMetrics {
  const valid = results.filter(
    (r) => r.totalPredictionError !== null && r.totalPredictionErrorPct !== null,
  );
  if (valid.length === 0) {
    return {
      sampleSize: 0,
      meanAbsoluteError: null,
      meanAbsolutePercentageError: null,
      bias: 'UNKNOWN',
      overestimateRate: null,
      averageRealizedRiskAdjustedProfit: null,
    };
  }
  const mae = valid.reduce((s, r) => s + Math.abs(r.totalPredictionError!), 0) / valid.length;
  const mape = valid.reduce((s, r) => s + Math.abs(r.totalPredictionErrorPct!), 0) / valid.length;
  const overestimates = valid.filter((r) => r.totalPredictionError! > 0).length;
  const avgRAP = valid
    .filter((r) => r.realizedRiskAdjustedProfit !== null)
    .reduce((s, r) => s + r.realizedRiskAdjustedProfit!, 0) / Math.max(1, valid.length);

  let bias: ModelMetrics['bias'] = 'ACCURATE';
  if (mape > 5) bias = overestimates > valid.length / 2 ? 'OVERESTIMATE' : 'UNDERESTIMATE';

  return {
    sampleSize: valid.length,
    meanAbsoluteError: round4(D(mae)).toNumber(),
    meanAbsolutePercentageError: round4(D(mape)).toNumber(),
    bias,
    overestimateRate: round4(D(overestimates / valid.length)).toNumber(),
    averageRealizedRiskAdjustedProfit: round4(D(avgRAP)).toNumber(),
  };
}
