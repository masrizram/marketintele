/**
 * Circuit Breaker — source-level reliability (IDEA.md §37 / AUDIT §48)
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED
 *
 * Default failure threshold: 5 consecutive failures (per IDEA.md §37).
 * Configurable recovery timeout.  Never continuously hammers a broken source.
 *
 * This is a pure, deterministic, testable implementation.  It does NOT depend
 * on wall-clock side effects for the state machine itself — transitions are
 * driven by explicit `recordSuccess` / `recordFailure` calls and an
 * externally-supplied `now()` timestamp, making it fully testable.
 */
import { ulid } from 'ulid';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening (default 5 per IDEA.md §37). */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning OPEN → HALF_OPEN. */
  recoveryTimeoutMs: number;
  /** Successes needed in HALF_OPEN to close again. */
  halfOpenSuccessThreshold: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
};

export interface CircuitBreakerSnapshot {
  sourceId: string;
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  totalFailures: number;
  totalSuccesses: number;
  totalTrips: number;
}

/**
 * Circuit breaker for a single source (supplier / marketplace / URL domain).
 *
 * Thread-safe in single-threaded Node — callers serialise through the event
 * loop.  For multi-process safety, wrap with a distributed lock/redis.
 */
export class CircuitBreaker {
  readonly sourceId: string;
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalTrips = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(sourceId: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.sourceId = sourceId;
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  /** Unique trip ID for audit logging. */
  static generateTripId(): string {
    return `cb_${ulid()}`;
  }

  /**
   * Whether a request is allowed to proceed.
   *
   * If OPEN and the recovery timeout has elapsed, transitions to HALF_OPEN
   * and allows a probe request.
   */
  canExecute(now: number): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return true; // probe allowed
    // OPEN — check if recovery timeout has elapsed
    if (this.openedAt !== null && now - this.openedAt >= this.config.recoveryTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.consecutiveSuccesses = 0;
      return true;
    }
    return false;
  }

  /** Record a successful call.  May transition HALF_OPEN → CLOSED. */
  recordSuccess(now: number): void {
    this.totalSuccesses++;
    this.lastSuccessAt = now;
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      if (this.consecutiveSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.state = 'CLOSED';
        this.openedAt = null;
        this.consecutiveFailures = 0;
      }
    }
  }

  /** Record a failed call.  May trip CLOSED → OPEN or HALF_OPEN → OPEN. */
  recordFailure(now: number): string | null {
    this.totalFailures++;
    this.lastFailureAt = now;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.state === 'CLOSED') {
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.trip(now);
        return CircuitBreaker.generateTripId();
      }
    } else if (this.state === 'HALF_OPEN') {
      // A failure during HALF_OPEN immediately re-opens the circuit.
      this.trip(now);
      return CircuitBreaker.generateTripId();
    }
    return null;
  }

  private trip(now: number): void {
    this.state = 'OPEN';
    this.openedAt = now;
    this.totalTrips++;
  }

  /** Force-close (manual reset / admin override). */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = null;
  }

  getState(): CircuitState {
    return this.state;
  }

  getSnapshot(): CircuitBreakerSnapshot {
    return {
      sourceId: this.sourceId,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      openedAt: this.openedAt,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalTrips: this.totalTrips,
    };
  }
}
