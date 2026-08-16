import Decimal from 'decimal.js';

/**
 * Exact Decimal Engine — wrapped around decimal.js with fixed precision (28)
 * and ROUND_HALF_EVEN rounding.  IEEE-754 floats are banned from all financial
 * logic; every monetary value flows through this wrapper.
 *
 * Precision 28 matches Python's `decimal.Decimal` default and gives us 28
 * significant digits — more than enough for IDR-denominated calculations with
 * up to 4 decimal places.
 */
const P = 28;
const R = Decimal.ROUND_HALF_EVEN;

export const PRECISION = P;
export const ROUNDING = R;

/** Maximum displayable IDR magnitude before we start warning about overflow */
export const MAX_IDR = new Decimal('999999999999999.9999');

/**
 * Create a Decimal from a number, string, or another Decimal.
 *
 * Strings are strongly preferred for monetary values to avoid float
 * representation errors at the entry boundary (e.g. `0.1 + 0.2`).
 *
 * THROWS on NaN, Infinity, or -Infinity — financial calculations must
 * never propagate non-finite values (IDEA.xml §96: zero/negative/missing).
 */
export function D(value: string | number | Decimal): Decimal {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ParseError(`Cannot create Decimal from non-finite number: ${value}`);
    }
    return new Decimal(value);
  }
  const d = new Decimal(value);
  if (d.isNaN() || !d.isFinite()) {
    throw new ParseError(`Cannot create Decimal from non-finite value: ${value}`);
  }
  return d;
}

/**
 * Convenience constructors for common IDR amounts.
 */
export function Rp(value: string | number | Decimal): Decimal {
  return D(value);
}

/**
 * Zero Decimal — useful as a starter for summations.
 */
export const ZERO: Decimal = new Decimal(0);

/**
 * One Decimal.
 */
export const ONE: Decimal = new Decimal(1);

/**
 * Check whether a Decimal is effectively zero (within our 4dp resolution).
 */
export function isZero(d: Decimal): boolean {
  return d.abs().lt(Decimal('0.00005'));
}

/**
 * Check whether a Decimal is positive (strictly greater than zero).
 */
export function isPositive(d: Decimal): boolean {
  return d.gt(ZERO);
}

/**
 * Check whether a Decimal is negative (strictly less than zero).
 */
export function isNegative(d: Decimal): boolean {
  return d.lt(ZERO);
}

/**
 * Safely add Decimals.  Returns UNDEFINED if any operand is NaN.
 */
export function add(...ds: Decimal[]): Decimal {
  return ds.reduce((a, b) => a.plus(b), ZERO);
}

/**
 * Safely subtract.  Returns UNDEFINED if any operand is NaN.
 */
export function sub(a: Decimal, b: Decimal): Decimal {
  return a.minus(b);
}

/**
 * Safely multiply.  Returns UNDEFINED if any operand is NaN.
 */
export function mul(...ds: Decimal[]): Decimal {
  return ds.reduce((a, b) => a.times(b), ONE);
}

/**
 * Safely divide.  Returns UNDEFINED if divisor is zero or NaN.
 */
export function div(a: Decimal, b: Decimal): Decimal {
  if (b.isZero()) throw new DivisionByZeroError('Cannot divide by zero in economic calculation');
  return a.div(b);
}

/**
 * Compute `base` raised to `exponent` with 4dp precision.
 */
export function pow(base: Decimal, exponent: Decimal): Decimal {
  return base.pow(exponent);
}

/**
 * Compute percentage: `(part / total) * 100` with 4dp precision.
 */
export function percentage(part: Decimal, total: Decimal): Decimal {
  if (total.isZero()) throw new DivisionByZeroError('Cannot compute percentage of zero');
  return div(part, total).times(100);
}

/**
 * Round to at most 4 decimal places using ROUND_HALF_EVEN.
 */
export function round4(d: Decimal): Decimal {
  return d.toDecimalPlaces(4, R);
}

/**
 * Format as Indonesian Rupiah string (e.g. "Rp1.234.567,89").
 * Trailing zeroes after the decimal point are trimmed.
 */
export function formatRp(d: Decimal): string {
  const rounded = round4(d);
  const str = rounded.toFixed(4);
  const [intPart, fracPart] = str.split('.');
  const cleanedFrac = fracPart.replace(/0+$/, '');
  const formattedInt = Number(intPart).toLocaleString('id-ID');
  if (cleanedFrac.length > 0) {
    return `Rp${formattedInt},${cleanedFrac.padEnd(2, '0').slice(0, 2)}`;
  }
  return `Rp${formattedInt}`;
}

/**
 * Format as a plain decimal number string with up to 4 dp.
 */
export function formatNumber(d: Decimal): string {
  return round4(d).toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Parse a formatted Indonesian Rupiah string back into a Decimal.
 * Accepts formats like "1234567", "1.234.567", "Rp1.234.567,89", "1234567.89".
 */
export function parseRp(raw: string): Decimal {
  const cleaned = raw
    .replace(/^Rp/i, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const parsed = new Decimal(cleaned);
  if (parsed.isNaN()) throw new ParseError(`Cannot parse Rp value from "${raw}"`);
  return parsed;
}

/**
 * Calculate absolute difference between two Decimals.
 */
export function absDiff(a: Decimal, b: Decimal): Decimal {
  return a.minus(b).abs();
}

/**
 * Validate that two independent calculations agree within tolerance.
 * Throws CalculationConflictError when they diverge beyond TOLERANCE.
 * Default tolerance is 1 IDR (0.5 rounds to 1 for practical purposes).
 */
export function validateReconciliation(
  engineA: Decimal,
  engineB: Decimal,
  tolerance: Decimal = new Decimal('1'),
): void {
  const diff = absDiff(engineA, engineB);
  if (diff.gt(tolerance)) {
    throw new CalculationConflictError(
      `Double-entry mismatch: Engine_A = ${formatRp(engineA)}, Engine_B = ${formatRp(engineB)}, delta = ${formatRp(diff)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error classes
// ─────────────────────────────────────────────────────────────────────────────

export class UncalculatedCostException extends Error {
  constructor(component: string) {
    super(`UNCALCULATED_COST: ${component} — unknown cost cannot be assumed zero (UNKNOWN != 0)`);
    this.name = 'UncalculatedCostException';
  }
}

export class InsufficientDemandDataError extends Error {
  constructor(productId: string) {
    super(`INSUFFICIENT_DATA: demand for product ${productId} is unknown — cannot fabricate estimate (INSUFFICIENT_DATA != LOW)`);
    this.name = 'InsufficientDemandDataError';
  }
}

export class WeakMatchAsExactError extends Error {
  constructor(matchType: string, productId: string) {
    super(`WEAK_MATCH_AS_EXACT: "${matchType}" for product ${productId} downgraded — semantic similarity alone never triggers EXACT_SAME_PRODUCT`);
    this.name = 'WeakMatchAsExactError';
  }
}

export class LowConfidenceAsFactError extends Error {
  constructor(component: string, score: number) {
    super(`LOW_CONFIDENCE_AS_FACT: ${component} confidence=${score} — rejected, must be above floor`);
    this.name = 'LowConfidenceAsFactError';
  }
}

export class OptimisticAsExpectedError extends Error {
  constructor(scenario: string) {
    super(`OPTIMISTIC_AS_EXPECTED: "${scenario}" scenario must not be presented as the expected result (OPTIMISTIC != EXPECTED)`);
    this.name = 'OptimisticAsExpectedError';
  }
}

export class DivisionByZeroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DivisionByZeroError';
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class CalculationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationConflictError';
  }
}
