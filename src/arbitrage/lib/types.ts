import { ulid } from 'ulid';
import { z } from 'zod';
import { sha256 } from '../lib/hash';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Zod primitives reused by every entity validator in the system.
// ─────────────────────────────────────────────────────────────────────────────

export const ULID = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a valid ULID');

export const TIMESTAMP_TZ = z
  .string()
  .datetime({ message: 'must be an ISO-8601 timestamp with timezone' });

export const PRICE_IDR = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'IDR prices must have at most 4 decimal places');

/** SHA-256 hex digest (64 chars, a-f0-9) */
export const SHA256_HASH = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'must be a valid SHA-256 hex digest');

/** HTTP status code */
export const HTTP_STATUS = z.number().int().min(100).max(599);

/** Non-negative integer for counts, quantities, etc. */
export const NON_NEG_INT = z.number().int().min(0);

/** Floating-point with fixed decimal places (max 4 for financial amounts) */
export const FIN_4DP = z
  .number()
  .positive()
  .max(999_999_999_999)
  .refine((v) => Math.round(v * 10000) === v * 10000, 'max 4 decimal places');

// ─────────────────────────────────────────────────────────────────────────────
// Canonical ULID generation — all primary keys are ULIDs in this system.
// ─────────────────────────────────────────────────────────────────────────────

export function genId(): string {
  return ulid();
}

/** Returns true if `value` is a plausible ULID (26-char Crockford base32). */
export function looksLikeId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/** Deterministic sha256 over an arbitrary object — useful for content hashing. */
export function hashContent(value: unknown): string {
  return sha256(JSON.stringify(value, (_, v) => (v === undefined ? null : v)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic JSONable / stringable helpers
// ─────────────────────────────────────────────────────────────────────────────

export type JsonValue = string | number | boolean | null | JsonArray | JsonRecord;
export interface JsonArray extends Array<JsonValue> {}
export interface JsonRecord { [key: string]: JsonValue }

export function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertNever(_x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(_x)}`);
}
