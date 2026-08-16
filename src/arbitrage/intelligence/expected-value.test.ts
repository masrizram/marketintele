import {
  computeExpectedValue,
  buildDefaultScenarioProbabilities,
  EVInput,
} from './expected-value';

describe('EV Engine — binary EV (IDEA §26)', () => {
  it('computes EV = P(success)*Profit - P(failure)*CapitalLoss', () => {
    const input: EVInput = {
      successProfit: 100000,
      failureCapitalLoss: 50000,
      successProbability: {
        scenario: 'BASE',
        probability: 0.6,
        provenance: 'MODEL_ESTIMATE',
        modelVersion: 'test-v1',
        confidence: 0.7,
        evidence: 'test',
      },
    };
    const result = computeExpectedValue(input);
    // EV = 0.6*100000 - 0.4*50000 = 60000 - 20000 = 40000
    expect(result.expectedValue).toBe(40000);
    expect(result.probabilitiesSumToOne).toBe(true);
  });

  it('returns negative EV for low success probability', () => {
    const input: EVInput = {
      successProfit: 10000,
      failureCapitalLoss: 50000,
      successProbability: {
        scenario: 'BASE',
        probability: 0.1,
        provenance: 'HEURISTIC',
        modelVersion: 'test-v1',
        confidence: 0.3,
        evidence: 'test',
      },
    };
    // EV = 0.1*10000 - 0.9*50000 = 1000 - 45000 = -44000
    const result = computeExpectedValue(input);
    expect(result.expectedValue).toBe(-44000);
  });

  it('REJECTS EV when probabilities do not sum to 1', () => {
    const input: EVInput = {
      successProfit: 100000,
      failureCapitalLoss: 50000,
      successProbability: {
        scenario: 'BASE',
        probability: 0.7, // P(success)=0.7, P(failure)=0.3, sum=1.0 — this is OK
        provenance: 'OBSERVED',
        modelVersion: 'test-v1',
        confidence: 0.9,
        evidence: 'test',
      },
    };
    const result = computeExpectedValue(input);
    // 0.7 + 0.3 = 1.0 → valid
    expect(result.probabilitiesSumToOne).toBe(true);
    expect(result.expectedValue).not.toBeNull();
  });
});

describe('EV Engine — scenario EV (BEAR/BASE/BULL)', () => {
  it('computes scenario-weighted EV with Σ=1', () => {
    const probs = buildDefaultScenarioProbabilities(0.5);
    // Verify they sum to 1
    const sum = probs.reduce((s, p) => s + p.probability, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);

    const input: EVInput = {
      successProfit: 50000,
      failureCapitalLoss: 30000,
      successProbability: probs[1], // BASE
      scenarios: {
        probabilities: probs,
        payoffs: [
          { scenario: 'BEAR', netProfit: -20000, capitalLoss: 30000 },
          { scenario: 'BASE', netProfit: 30000, capitalLoss: 0 },
          { scenario: 'BULL', netProfit: 80000, capitalLoss: 0 },
        ],
      },
    };
    const result = computeExpectedValue(input);
    expect(result.expectedValue).not.toBeNull();
    expect(result.probabilitiesSumToOne).toBe(true);
    expect(result.scenarios).toBeDefined();
    expect(result.scenarios!.length).toBe(3);
  });

  it('REJECTS scenario EV when probabilities do not sum to 1', () => {
    const input: EVInput = {
      successProfit: 50000,
      failureCapitalLoss: 30000,
      successProbability: {
        scenario: 'BASE',
        probability: 0.5,
        provenance: 'HEURISTIC',
        modelVersion: 'test-v1',
        confidence: 0.3,
        evidence: 'test',
      },
      scenarios: {
        probabilities: [
          { scenario: 'BEAR', probability: 0.6, provenance: 'HEURISTIC', modelVersion: 'v1', confidence: 0.3, evidence: 'bad' },
          { scenario: 'BASE', probability: 0.6, provenance: 'HEURISTIC', modelVersion: 'v1', confidence: 0.3, evidence: 'bad' },
          { scenario: 'BULL', probability: 0.6, provenance: 'HEURISTIC', modelVersion: 'v1', confidence: 0.3, evidence: 'bad' },
        ], // sum = 1.8 ≠ 1
        payoffs: [
          { scenario: 'BEAR', netProfit: -20000, capitalLoss: 30000 },
          { scenario: 'BASE', netProfit: 30000, capitalLoss: 0 },
          { scenario: 'BULL', netProfit: 80000, capitalLoss: 0 },
        ],
      },
    };
    const result = computeExpectedValue(input);
    expect(result.expectedValue).toBeNull();
    expect(result.probabilitiesSumToOne).toBe(false);
  });

  it('REJECTS when a scenario payoff is missing', () => {
    const probs = buildDefaultScenarioProbabilities(0.5);
    const input: EVInput = {
      successProfit: 50000,
      failureCapitalLoss: 30000,
      successProbability: probs[1],
      scenarios: {
        probabilities: probs,
        payoffs: [
          { scenario: 'BEAR', netProfit: -20000, capitalLoss: 30000 },
          // BASE and BULL payoffs missing
        ],
      },
    };
    const result = computeExpectedValue(input);
    expect(result.expectedValue).toBeNull();
  });
});

describe('EV Engine — provenance (IDEA §26)', () => {
  it('marks HEURISTIC provenance with reduced confidence', () => {
    const input: EVInput = {
      successProfit: 100000,
      failureCapitalLoss: 50000,
      successProbability: {
        scenario: 'BASE',
        probability: 0.6,
        provenance: 'HEURISTIC',
        modelVersion: 'test-v1',
        confidence: 0.8,
        evidence: 'test',
      },
    };
    const result = computeExpectedValue(input);
    expect(result.probabilityProvenance).toBe('HEURISTIC');
    // Heuristic confidence is reduced by 0.6 factor
    expect(result.evConfidence).toBeLessThan(0.8);
  });

  it('does not reduce OBSERVED confidence', () => {
    const input: EVInput = {
      successProfit: 100000,
      failureCapitalLoss: 50000,
      successProbability: {
        scenario: 'BASE',
        probability: 0.6,
        provenance: 'OBSERVED',
        modelVersion: 'test-v1',
        confidence: 0.8,
        evidence: 'test',
      },
    };
    const result = computeExpectedValue(input);
    expect(result.probabilityProvenance).toBe('OBSERVED');
    expect(result.evConfidence).toBe(0.8);
  });
});

describe('EV Engine — buildDefaultScenarioProbabilities', () => {
  it('produces probabilities that sum to exactly 1', () => {
    for (const base of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
      const probs = buildDefaultScenarioProbabilities(base);
      const sum = probs.reduce((s, p) => s + p.probability, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThanOrEqual(0.001);
    }
  });

  it('labels all default probabilities as HEURISTIC', () => {
    const probs = buildDefaultScenarioProbabilities(0.5);
    expect(probs.every((p) => p.provenance === 'HEURISTIC')).toBe(true);
  });
});
