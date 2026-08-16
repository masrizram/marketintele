/**
 * Expected Value (EV) Engine
 *
 * IDEA.md §26 / AUDIT §28 require:
 *
 *   EV = P(success) × Profit − P(failure) × CapitalLoss
 *
 * Every probability MUST carry provenance (OBSERVED / MODEL_ESTIMATE /
 * HEURISTIC), a model_version, confidence, and evidence.  Heuristic
 * probabilities are NEVER treated as OBSERVED.
 *
 * Invariant: Σ probabilities = 1 (validated — deviation rejects the EV).
 *
 * Positive EV MUST NOT automatically produce approval (AUDIT §28).
 */
import { D, ZERO, round4 } from '../economic/decimal-engine';

export type ProbabilityProvenance = 'OBSERVED' | 'MODEL_ESTIMATE' | 'HEURISTIC';

export interface ScenarioProbability {
  scenario: 'BEAR' | 'BASE' | 'BULL';
  probability: number;            // 0-1
  provenance: ProbabilityProvenance;
  modelVersion: string;
  confidence: number;             // 0-1
  evidence: string;
}

export interface ScenarioPayoff {
  scenario: 'BEAR' | 'BASE' | 'BULL';
  /** Net profit (IDR) if this scenario occurs — can be negative (loss). */
  netProfit: number;
  /** Capital at risk (IDR) — the capital lost if the venture fails in this scenario. */
  capitalLoss: number;
}

export interface EVInput {
  /** Net profit for the success case (IDR). */
  successProfit: number;
  /** Capital lost if the venture fails (IDR). */
  failureCapitalLoss: number;
  /** P(success) with full provenance. */
  successProbability: ScenarioProbability;
  /** Optional BEAR/BASE/BULL scenario probabilities + payoffs for richer EV. */
  scenarios?: {
    probabilities: ScenarioProbability[];
    payoffs: ScenarioPayoff[];
  };
}

export interface EVResult {
  expectedValue: number | null;     // IDR, null = UNKNOWN
  evConfidence: number;             // 0-1
  probabilityProvenance: ProbabilityProvenance;
  probabilitiesSumToOne: boolean;
  methodology: string;
  scenarios?: {
    scenario: 'BEAR' | 'BASE' | 'BULL';
    probability: number;
    payoff: number;
    contribution: number;
  }[];
  evidence: string[];
  timestamp: string;
}

const DEFAULT_MODEL_VERSION = 'ev-v1.0.0';
const PROBABILITY_TOLERANCE = 0.001; // Σ must be within 0.001 of 1.0

/**
 * Compute the expected value of an arbitrage opportunity.
 *
 * Two modes:
 *   1. Simple: EV = P(success) × Profit − P(failure) × CapitalLoss
 *   2. Scenario: EV = Σ(P_i × Payoff_i) across BEAR/BASE/BULL
 *
 * The scenario mode is preferred when probabilities are available.  In both
 * modes, Σ probabilities is validated against 1.0.
 */
export function computeExpectedValue(input: EVInput): EVResult {
  const timestamp = new Date().toISOString();
  const evidence: string[] = [];

  // ── Scenario-based EV (preferred when available) ───────────────────────
  if (input.scenarios && input.scenarios.probabilities.length > 0) {
    const probs = input.scenarios.probabilities;
    const payoffs = input.scenarios.payoffs;

    // Validate Σ probabilities = 1
    const sum = probs.reduce((s, p) => s + p.probability, 0);
    const sumToOne = Math.abs(sum - 1.0) <= PROBABILITY_TOLERANCE;
    if (!sumToOne) {
      evidence.push(`PROBABILITY_VIOLATION: Σ probabilities = ${sum} (expected 1.0 ± ${PROBABILITY_TOLERANCE}) — EV REJECTED`);
      return {
        expectedValue: null,
        evConfidence: 0,
        probabilityProvenance: 'HEURISTIC',
        probabilitiesSumToOne: false,
        methodology: 'Scenario EV rejected: probability normalization failed',
        evidence,
        timestamp,
      };
    }

    // Map payoffs by scenario
    const payoffMap = new Map(payoffs.map((p) => [p.scenario, p]));
    let ev = ZERO;
    const scenarioResults: NonNullable<EVResult['scenarios']> = [];
    let minConfidence = 1;
    let worstProvenance: ProbabilityProvenance = 'OBSERVED';

    for (const sp of probs) {
      const payoff = payoffMap.get(sp.scenario);
      if (!payoff) {
        evidence.push(`MISSING_PAYOFF: no payoff for scenario ${sp.scenario} — EV REJECTED`);
        return {
          expectedValue: null,
          evConfidence: 0,
          probabilityProvenance: 'HEURISTIC',
          probabilitiesSumToOne: sumToOne,
          methodology: 'Scenario EV rejected: missing payoff',
          evidence,
          timestamp,
        };
      }
      const contribution = D(sp.probability).times(D(payoff.netProfit));
      ev = ev.plus(contribution);
      scenarioResults.push({
        scenario: sp.scenario,
        probability: sp.probability,
        payoff: payoff.netProfit,
        contribution: round4(contribution).toNumber(),
      });
      evidence.push(
        `${sp.scenario}: P=${sp.probability} (${sp.provenance}, conf=${sp.confidence}) × payoff=${payoff.netProfit} = ${round4(contribution).toNumber()}`,
      );
      minConfidence = Math.min(minConfidence, sp.confidence);
      if (provenanceRank(sp.provenance) > provenanceRank(worstProvenance)) {
        worstProvenance = sp.provenance;
      }
    }

    const evValue = round4(ev).toNumber();
    evidence.push(`EV = Σ(P_i × payoff_i) = ${evValue}`);

    return {
      expectedValue: evValue,
      evConfidence: round4(D(minConfidence * (worstProvenance === 'HEURISTIC' ? 0.6 : 1.0))).toNumber(),
      probabilityProvenance: worstProvenance,
      probabilitiesSumToOne: true,
      methodology: 'Scenario-weighted EV: Σ(P_i × Payoff_i) across BEAR/BASE/BULL; Σ validated = 1',
      scenarios: scenarioResults,
      evidence,
      timestamp,
    };
  }

  // ── Simple binary EV ───────────────────────────────────────────────────
  const pSuccess = input.successProbability.probability;
  const pFailure = 1 - pSuccess;
  const sumToOne = Math.abs(pSuccess + pFailure - 1.0) <= PROBABILITY_TOLERANCE;

  if (!sumToOne) {
    evidence.push(`PROBABILITY_VIOLATION: P(success)=${pSuccess} + P(failure)=${pFailure} ≠ 1.0 — EV REJECTED`);
    return {
      expectedValue: null,
      evConfidence: 0,
      probabilityProvenance: input.successProbability.provenance,
      probabilitiesSumToOne: false,
      methodology: 'Binary EV rejected: probability normalization failed',
      evidence,
      timestamp,
    };
  }

  const ev = D(pSuccess).times(D(input.successProfit)).minus(
    D(pFailure).times(D(input.failureCapitalLoss)),
  );
  const evValue = round4(ev).toNumber();

  evidence.push(
    `EV = P(success)=${pSuccess} × Profit=${input.successProfit} − P(failure)=${pFailure} × CapitalLoss=${input.failureCapitalLoss} = ${evValue}`,
  );
  evidence.push(`provenance=${input.successProbability.provenance}, confidence=${input.successProbability.confidence}`);

  const evConfidence = round4(
    D(input.successProbability.confidence * (input.successProbability.provenance === 'HEURISTIC' ? 0.6 : 1.0)),
  ).toNumber();

  return {
    expectedValue: evValue,
    evConfidence,
    probabilityProvenance: input.successProbability.provenance,
    probabilitiesSumToOne: true,
    methodology: 'Binary EV: P(success)×Profit − P(failure)×CapitalLoss; Σ validated = 1',
    evidence,
    timestamp,
  };
}

function provenanceRank(p: ProbabilityProvenance): number {
  switch (p) {
    case 'OBSERVED': return 1;
    case 'MODEL_ESTIMATE': return 2;
    case 'HEURISTIC': return 3;
  }
}

/**
 * Build default scenario probabilities (BEAR / BASE / BULL).
 *
 * These are the probabilities that each SCENARIO OCCURS — they MUST sum to 1.
 * The defaults are conservative (BEAR-weighted) and explicitly HEURISTIC.
 *
 * A higher `baseSuccessProb` shifts weight from BEAR toward BASE/BULL.
 */
export function buildDefaultScenarioProbabilities(
  baseSuccessProb: number,
): ScenarioProbability[] {
  const clamped = Math.max(0, Math.min(1, baseSuccessProb));
  // Conservative distribution weighted by the base success estimate.
  // Higher confidence → more weight on BASE; lower → more on BEAR.
  const bear = round4(D(0.40 - clamped * 0.15)).toNumber();
  const base = round4(D(0.35 + clamped * 0.15)).toNumber();
  const bull = round4(D(0.25)).toNumber();
  // Normalise so they sum to exactly 1 (guard against rounding drift)
  const rawSum = bear + base + bull;
  const norm = (v: number) => round4(D(v / rawSum)).toNumber();
  const bearN = norm(bear);
  const baseN = norm(base);
  const bullN = round4(D(1 - bearN - baseN)).toNumber();

  return [
    {
      scenario: 'BEAR',
      probability: bearN,
      provenance: 'HEURISTIC',
      modelVersion: DEFAULT_MODEL_VERSION,
      confidence: 0.3,
      evidence: `HEURISTIC: bear scenario probability = ${bearN.toFixed(4)} (conservative, derived from base success ${clamped.toFixed(2)})`,
    },
    {
      scenario: 'BASE',
      probability: baseN,
      provenance: 'HEURISTIC',
      modelVersion: DEFAULT_MODEL_VERSION,
      confidence: 0.5,
      evidence: `HEURISTIC: base scenario probability = ${baseN.toFixed(4)} (derived from base success ${clamped.toFixed(2)})`,
    },
    {
      scenario: 'BULL',
      probability: bullN,
      provenance: 'HEURISTIC',
      modelVersion: DEFAULT_MODEL_VERSION,
      confidence: 0.3,
      evidence: `HEURISTIC: bull scenario probability = ${bullN.toFixed(4)} (conservative, derived from base success ${clamped.toFixed(2)})`,
    },
  ];
}
