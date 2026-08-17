/**
 * Price normalization contract (shared by all adapters).
 *
 * parsePrice(input: unknown): number | null
 *
 * Rules:
 *   - finite number             → return that number
 *   - numeric string            → parse and return a finite number
 *   - currency-formatted string → parse the leading digits safely
 *   - null / undefined          → null
 *   - malformed input           → null
 *   - NaN                       → null
 *   - Infinity / -Infinity      → null
 *   - NEVER throws a TypeError because of the input type
 *
 * A single source of truth so no adapter re-implements string-only price
 * parsing that can crash when a number is passed in (the discovery pipeline
 * double-normalizes some products).
 */

/**
 * Convert an unknown price value into a finite number or null.
 *
 * Currency-formatted strings such as "Rp120.000", "IDR 29.900",
 * "$1,299.99", or "Rp18.990" are reduced to the digits (dot/comma
 * separators are treated as thousand separators and stripped). Values that
 * cannot be reduced to a finite number return null.
 */
export function parsePrice(input: unknown): number | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;

    // Extract the first run of digits with optional thousands separators.
    // Handles "Rp120.000", "IDR 29.900", "$1,299.99", "120000", etc.
    const match = trimmed.match(/\d[\d.,]*/);
    if (!match) return null;

    const digitsOnly = match[0].replace(/[.,]/g, '');
    if (digitsOnly.length === 0) return null;

    const num = Number(digitsOnly);
    return Number.isFinite(num) ? num : null;
  }

  // Any other type (object, boolean, symbol, bigint, function, ...) — null.
  return null;
}

/**
 * Normalize a raw price value without double-parsing when it is already a
 * number. Equivalent to parsePrice, but named for the adapter `normalize()`
 * entry points where `raw.price` may already be numeric.
 */
export function normalizePrice(input: unknown): number | null {
  return parsePrice(input);
}
