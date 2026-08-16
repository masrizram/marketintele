/**
 * Opportunity Lifecycle State Machine
 *
 * IDEA.md §29 / AUDIT §30 require a state machine:
 *
 *   DISCOVERED → ANALYZING → VALIDATING → VERIFIED → TESTING → SCALING
 *
 * Terminal / exceptional states: REJECTED, EXPIRED, COLLAPSED, PAUSED,
 * INVALIDATED.
 *
 * Every transition MUST be: valid, logged, timestamped, attributable,
 * idempotent where required, concurrency-safe.  Illegal transitions are
 * REJECTED (never silently coerced).
 */
import { ulid } from 'ulid';

export type OpportunityState =
  | 'DISCOVERED'
  | 'ANALYZING'
  | 'VALIDATING'
  | 'VERIFIED'
  | 'TESTING'
  | 'SCALING'
  | 'MONITORING'
  | 'ALERTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'COLLAPSED'
  | 'PAUSED'
  | 'INVALIDATED';

export interface TransitionRecord {
  id: string;
  opportunityId: string;
  sourceState: OpportunityState;
  targetState: OpportunityState;
  reason: string;
  actor: string;
  timestamp: string;
  auditEvent: string;
}

export interface TransitionAttempt {
  sourceState: OpportunityState;
  targetState: OpportunityState;
  reason: string;
  actor: string;
  timestamp: string;
}

/**
 * Legal transitions map.  Any transition not in this set is REJECTED.
 *
 * Design principle: forward progress only (no skipping validation),
 * explicit terminal entry, explicit pause/resume.
 */
const LEGAL_TRANSITIONS: Record<OpportunityState, OpportunityState[]> = {
  DISCOVERED: ['ANALYZING', 'REJECTED', 'EXPIRED', 'INVALIDATED'],
  ANALYZING: ['VALIDATING', 'REJECTED', 'PAUSED', 'EXPIRED'],
  VALIDATING: ['VERIFIED', 'REJECTED', 'PAUSED', 'EXPIRED', 'INVALIDATED'],
  VERIFIED: ['TESTING', 'ALERTED', 'REJECTED', 'PAUSED', 'EXPIRED'],
  TESTING: ['SCALING', 'MONITORING', 'REJECTED', 'COLLAPSED', 'PAUSED'],
  SCALING: ['MONITORING', 'COLLAPSED', 'PAUSED', 'EXPIRED'],
  MONITORING: ['SCALING', 'COLLAPSED', 'EXPIRED', 'PAUSED'],
  ALERTED: ['TESTING', 'EXPIRED', 'COLLAPSED'],
  REJECTED: [],
  EXPIRED: [],
  COLLAPSED: [],
  PAUSED: ['ANALYZING', 'VALIDATING', 'VERIFIED', 'TESTING', 'EXPIRED', 'REJECTED'],
  INVALIDATED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly opportunityId: string,
    public readonly source: OpportunityState,
    public readonly target: OpportunityState,
  ) {
    super(
      `ILLEGAL_TRANSITION: opportunity ${opportunityId} cannot go ${source} → ${target}`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export const TERMINAL_STATES: ReadonlySet<OpportunityState> = new Set([
  'REJECTED', 'EXPIRED', 'COLLAPSED', 'INVALIDATED',
]);

/**
 * Check whether a transition is legal WITHOUT performing it.
 */
export function isLegalTransition(
  source: OpportunityState,
  target: OpportunityState,
): boolean {
  if (source === target) return false;
  const allowed = LEGAL_TRANSITIONS[source];
  return allowed ? allowed.includes(target) : false;
}

/**
 * Opportunity lifecycle manager.
 *
 * Tracks the current state + full audit trail of transitions for a single
 * opportunity.  Transitions are atomic and rejected if illegal.
 */
export class OpportunityLifecycle {
  private state: OpportunityState;
  private readonly transitions: TransitionRecord[] = [];

  constructor(
    public readonly opportunityId: string,
    initialState: OpportunityState = 'DISCOVERED',
  ) {
    this.state = initialState;
  }

  getState(): OpportunityState {
    return this.state;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  /**
   * Attempt a state transition.  Throws IllegalTransitionError if the
   * transition is not in the legal set.
   */
  transition(target: OpportunityState, reason: string, actor: string, now: string = new Date().toISOString()): TransitionRecord {
    const source = this.state;
    if (!isLegalTransition(source, target)) {
      throw new IllegalTransitionError(this.opportunityId, source, target);
    }
    const record: TransitionRecord = {
      id: `trans_${ulid()}`,
      opportunityId: this.opportunityId,
      sourceState: source,
      targetState: target,
      reason,
      actor,
      timestamp: now,
      auditEvent: `${source}→${target}`,
    };
    this.transitions.push(record);
    this.state = target;
    return record;
  }

  /** Idempotent: transition to a terminal state only if not already terminal. */
  transitionToTerminal(
    target: OpportunityState,
    reason: string,
    actor: string,
    now: string = new Date().toISOString(),
  ): TransitionRecord | null {
    if (this.isTerminal()) return null; // already terminal — no-op (idempotent)
    if (!TERMINAL_STATES.has(target)) {
      throw new IllegalTransitionError(this.opportunityId, this.state, target);
    }
    return this.transition(target, reason, actor, now);
  }

  getTransitions(): TransitionRecord[] {
    return [...this.transitions];
  }
}
