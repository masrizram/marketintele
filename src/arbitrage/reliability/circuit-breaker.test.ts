import { CircuitBreaker, DEFAULT_CIRCUIT_CONFIG } from './circuit-breaker';

describe('Circuit Breaker — default config (IDEA §37)', () => {
  it('has failure threshold = 5 per IDEA.md §37', () => {
    expect(DEFAULT_CIRCUIT_CONFIG.failureThreshold).toBe(5);
  });

  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute(0)).toBe(true);
  });
});

describe('Circuit Breaker — CLOSED → OPEN at threshold 5', () => {
  it('does NOT trip after 4 failures', () => {
    const cb = new CircuitBreaker('test');
    let t = 0;
    for (let i = 0; i < 4; i++) {
      cb.recordFailure(t);
      t += 1000;
    }
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute(t)).toBe(true);
  });

  it('trips to OPEN on the 5th consecutive failure', () => {
    const cb = new CircuitBreaker('test');
    let t = 0;
    for (let i = 0; i < 5; i++) {
      cb.recordFailure(t);
      t += 1000;
    }
    expect(cb.getState()).toBe('OPEN');
    // OPEN circuit must NOT allow execution until recovery timeout
    expect(cb.canExecute(t)).toBe(false);
  });

  it('resets failure count on success (no premature trip)', () => {
    const cb = new CircuitBreaker('test');
    cb.recordFailure(0); cb.recordFailure(1000); cb.recordFailure(2000); cb.recordFailure(3000);
    cb.recordSuccess(4000); // resets consecutive failures
    cb.recordFailure(5000); cb.recordFailure(6000); cb.recordFailure(7000); cb.recordFailure(8000);
    // Only 4 consecutive since the last success → still CLOSED
    expect(cb.getState()).toBe('CLOSED');
  });
});

describe('Circuit Breaker — OPEN → HALF_OPEN → CLOSED', () => {
  it('transitions to HALF_OPEN after recovery timeout', () => {
    const cb = new CircuitBreaker('test', { recoveryTimeoutMs: 5000, halfOpenSuccessThreshold: 2 });
    let t = 0;
    for (let i = 0; i < 5; i++) { cb.recordFailure(t); t += 1000; }
    expect(cb.getState()).toBe('OPEN');
    // Before timeout → blocked
    expect(cb.canExecute(t)).toBe(false);
    // After timeout → HALF_OPEN, probe allowed
    expect(cb.canExecute(t + 5001)).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('closes after halfOpenSuccessThreshold successes', () => {
    const cb = new CircuitBreaker('test', { recoveryTimeoutMs: 1000, halfOpenSuccessThreshold: 2 });
    let t = 0;
    for (let i = 0; i < 5; i++) { cb.recordFailure(t); t += 1000; }
    // Wait for recovery
    expect(cb.canExecute(t + 1001)).toBe(true); // → HALF_OPEN
    expect(cb.getState()).toBe('HALF_OPEN');
    cb.recordSuccess(t + 1001);
    expect(cb.getState()).toBe('HALF_OPEN'); // need 2 successes
    cb.recordSuccess(t + 1001);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('re-opens immediately on failure during HALF_OPEN', () => {
    const cb = new CircuitBreaker('test', { recoveryTimeoutMs: 1000, halfOpenSuccessThreshold: 2 });
    let t = 0;
    for (let i = 0; i < 5; i++) { cb.recordFailure(t); t += 1000; }
    expect(cb.canExecute(t + 1001)).toBe(true); // HALF_OPEN
    cb.recordFailure(t + 1001); // failure during probe → re-open
    expect(cb.getState()).toBe('OPEN');
  });
});

describe('Circuit Breaker — snapshot/audit', () => {
  it('tracks totalFailures, totalSuccesses, totalTrips', () => {
    const cb = new CircuitBreaker('test');
    cb.recordFailure(0); cb.recordFailure(1000); cb.recordFailure(2000);
    cb.recordSuccess(3000);
    cb.recordFailure(4000); cb.recordFailure(5000); cb.recordFailure(6000);
    cb.recordFailure(7000); cb.recordFailure(8000); // 5th consecutive → trip
    const snap = cb.getSnapshot();
    expect(snap.totalFailures).toBe(8);
    expect(snap.totalSuccesses).toBe(1);
    expect(snap.totalTrips).toBe(1);
    expect(snap.state).toBe('OPEN');
  });

  it('reset() forces CLOSED', () => {
    const cb = new CircuitBreaker('test');
    let t = 0;
    for (let i = 0; i < 5; i++) { cb.recordFailure(t); t += 1000; }
    expect(cb.getState()).toBe('OPEN');
    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
  });
});
