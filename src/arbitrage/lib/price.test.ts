/**
 * Price normalization contract tests.
 *
 * Verifies the shared parsePrice/normalizePrice invariant:
 * finite number in, finite number out; anything else that cannot be reduced
 * to a finite number becomes null — and never a TypeError.
 */
import { parsePrice, normalizePrice } from './price';

describe('parsePrice — number input', () => {
  it('returns a finite number unchanged', () => {
    expect(parsePrice(18990)).toBe(18990);
  });

  it('returns 0 unchanged (finite)', () => {
    expect(parsePrice(0)).toBe(0);
  });

  it('returns null for NaN', () => {
    expect(parsePrice(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(parsePrice(Infinity)).toBeNull();
  });

  it('returns null for -Infinity', () => {
    expect(parsePrice(-Infinity)).toBeNull();
  });
});

describe('parsePrice — string input', () => {
  it('parses a plain numeric string', () => {
    expect(parsePrice('18990')).toBe(18990);
  });

  it('parses currency-formatted "Rp18.990"', () => {
    expect(parsePrice('Rp18.990')).toBe(18990);
  });

  it('parses currency-formatted "Rp120.000"', () => {
    expect(parsePrice('Rp120.000')).toBe(120000);
  });

  it('parses "IDR 29.900"', () => {
    expect(parsePrice('IDR 29.900')).toBe(29900);
  });

  it('parses comma-separated "$1,299.99"', () => {
    expect(parsePrice('$1,299.99')).toBe(129999);
  });

  it('returns null for empty string', () => {
    expect(parsePrice('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parsePrice('   ')).toBeNull();
  });

  it('returns null for a malformed string', () => {
    expect(parsePrice('no price')).toBeNull();
  });
});

describe('parsePrice — null / undefined / other types', () => {
  it('returns null for null', () => {
    expect(parsePrice(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parsePrice(undefined)).toBeNull();
  });

  it('returns null for an object', () => {
    expect(parsePrice({})).toBeNull();
  });

  it('returns null for a boolean', () => {
    expect(parsePrice(true)).toBeNull();
  });

  it('never throws on arbitrary input', () => {
    expect(() => parsePrice(Symbol('x'))).not.toThrow();
    expect(() => parsePrice(1n)).not.toThrow();
    expect(() => parsePrice(() => 1)).not.toThrow();
  });
});

describe('normalizePrice', () => {
  it('is equivalent to parsePrice for numbers', () => {
    expect(normalizePrice(123)).toBe(123);
    expect(normalizePrice(NaN)).toBeNull();
    expect(normalizePrice(Infinity)).toBeNull();
  });

  it('is equivalent to parsePrice for strings', () => {
    expect(normalizePrice('Rp45.000')).toBe(45000);
    expect(normalizePrice('bad')).toBeNull();
  });

  it('handles null/undefined', () => {
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
  });
});
