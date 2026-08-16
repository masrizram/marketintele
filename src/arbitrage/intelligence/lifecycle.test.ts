import {
  OpportunityLifecycle,
  isLegalTransition,
  IllegalTransitionError,
  TERMINAL_STATES,
  OpportunityState,
} from './lifecycle';

describe('Opportunity Lifecycle — legal transitions (IDEA §29)', () => {
  it('starts in DISCOVERED state', () => {
    const lc = new OpportunityLifecycle('opp_1');
    expect(lc.getState()).toBe('DISCOVERED');
    expect(lc.isTerminal()).toBe(false);
  });

  it('allows DISCOVERED → ANALYZING → VALIDATING → VERIFIED', () => {
    const lc = new OpportunityLifecycle('opp_1');
    lc.transition('ANALYZING', 'analysis started', 'system');
    expect(lc.getState()).toBe('ANALYZING');
    lc.transition('VALIDATING', 'validation started', 'system');
    expect(lc.getState()).toBe('VALIDATING');
    lc.transition('VERIFIED', 'all gates passed', 'system');
    expect(lc.getState()).toBe('VERIFIED');
  });

  it('allows VERIFIED → TESTING → SCALING', () => {
    const lc = new OpportunityLifecycle('opp_1', 'VERIFIED');
    lc.transition('TESTING', 'test order placed', 'operator');
    expect(lc.getState()).toBe('TESTING');
    lc.transition('SCALING', 'test succeeded, scaling', 'operator');
    expect(lc.getState()).toBe('SCALING');
  });

  it('REJECTS skipping validation (DISCOVERED → VERIFIED)', () => {
    const lc = new OpportunityLifecycle('opp_1');
    expect(() => lc.transition('VERIFIED', 'skip', 'bad')).toThrow(IllegalTransitionError);
    expect(lc.getState()).toBe('DISCOVERED'); // unchanged
  });

  it('REJECTS reverse transitions (SCALING → DISCOVERED)', () => {
    const lc = new OpportunityLifecycle('opp_1', 'SCALING');
    expect(() => lc.transition('DISCOVERED', 'reverse', 'bad')).toThrow(IllegalTransitionError);
  });

  it('REJECTS same-state transitions', () => {
    const lc = new OpportunityLifecycle('opp_1', 'VERIFIED');
    expect(() => lc.transition('VERIFIED', 'noop', 'system')).toThrow(IllegalTransitionError);
  });
});

describe('Opportunity Lifecycle — terminal states', () => {
  it('can transition to REJECTED from ANALYZING', () => {
    const lc = new OpportunityLifecycle('opp_1', 'ANALYZING');
    lc.transition('REJECTED', 'failed gates', 'system');
    expect(lc.getState()).toBe('REJECTED');
    expect(lc.isTerminal()).toBe(true);
  });

  it('cannot transition out of terminal state', () => {
    const lc = new OpportunityLifecycle('opp_1', 'REJECTED');
    expect(() => lc.transition('ANALYZING', 'revive', 'bad')).toThrow(IllegalTransitionError);
  });

  it('transitionToTerminal is idempotent', () => {
    const lc = new OpportunityLifecycle('opp_1', 'ANALYZING');
    const r1 = lc.transitionToTerminal('REJECTED', 'failed', 'system');
    expect(r1).not.toBeNull();
    const r2 = lc.transitionToTerminal('REJECTED', 'failed again', 'system');
    expect(r2).toBeNull(); // already terminal → no-op
  });

  it('COLLAPSE detection from TESTING', () => {
    const lc = new OpportunityLifecycle('opp_1', 'TESTING');
    lc.transition('COLLAPSED', 'market price dropped 20%', 'system');
    expect(lc.getState()).toBe('COLLAPSED');
    expect(lc.isTerminal()).toBe(true);
  });

  it('PAUSE and RESUME works', () => {
    const lc = new OpportunityLifecycle('opp_1', 'VALIDATING');
    lc.transition('PAUSED', 'manual hold', 'operator');
    expect(lc.getState()).toBe('PAUSED');
    expect(lc.isTerminal()).toBe(false);
    lc.transition('VALIDATING', 'resumed', 'operator');
    expect(lc.getState()).toBe('VALIDATING');
  });
});

describe('Opportunity Lifecycle — audit trail', () => {
  it('records every transition with full metadata', () => {
    const lc = new OpportunityLifecycle('opp_1');
    const r = lc.transition('ANALYZING', 'start', 'system', '2026-01-01T00:00:00Z');
    expect(r.sourceState).toBe('DISCOVERED');
    expect(r.targetState).toBe('ANALYZING');
    expect(r.reason).toBe('start');
    expect(r.actor).toBe('system');
    expect(r.timestamp).toBe('2026-01-01T00:00:00Z');
    expect(r.auditEvent).toBe('DISCOVERED→ANALYZING');
    expect(lc.getTransitions().length).toBe(1);
  });
});

describe('Opportunity Lifecycle — isLegalTransition helper', () => {
  const legalCases: [OpportunityState, OpportunityState][] = [
    ['DISCOVERED', 'ANALYZING'],
    ['ANALYZING', 'VALIDATING'],
    ['VALIDATING', 'VERIFIED'],
    ['VERIFIED', 'TESTING'],
    ['TESTING', 'SCALING'],
    ['SCALING', 'MONITORING'],
  ];
  for (const [src, tgt] of legalCases) {
    it(`legal: ${src} → ${tgt}`, () => {
      expect(isLegalTransition(src, tgt)).toBe(true);
    });
  }

  const illegalCases: [OpportunityState, OpportunityState][] = [
    ['DISCOVERED', 'VERIFIED'],
    ['DISCOVERED', 'SCALING'],
    ['REJECTED', 'ANALYZING'],
    ['EXPIRED', 'DISCOVERED'],
    ['COLLAPSED', 'SCALING'],
  ];
  for (const [src, tgt] of illegalCases) {
    it(`illegal: ${src} → ${tgt}`, () => {
      expect(isLegalTransition(src, tgt)).toBe(false);
    });
  }

  it('TERMINAL_STATES contains all terminal states', () => {
    expect(TERMINAL_STATES.has('REJECTED')).toBe(true);
    expect(TERMINAL_STATES.has('EXPIRED')).toBe(true);
    expect(TERMINAL_STATES.has('COLLAPSED')).toBe(true);
    expect(TERMINAL_STATES.has('INVALIDATED')).toBe(true);
    expect(TERMINAL_STATES.has('VERIFIED')).toBe(false);
  });
});
