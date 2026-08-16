/**
 * Common constants for the arbitrage engine.
 *
 * These are derived from Indonesian market conventions. They live here so
 * that all modules reference a single source of truth instead of hardcoding
 * magic numbers in business logic.
 */
export const ID_CURRENCY = 'IDR';
export const ID_CURRENCY_SYMBOL = 'Rp';

/** Standard unit conversions for Indonesian commerce */
export const UNIT_CONVERSIONS = {
  /** 1 karton = N pcs (varies by product; callers must supply the multiplier) */
  KARTON_TO_PCS: 'karton_to_pcs',
} as const;

/** Default MOQ floor — suppliers listing MOQ below this are suspicious */
export const DEFAULT_MOQ_FLOOR = 1;

/** Default confidence score floor for recommending an opportunity */
export const CONFIDENCE_FLOOR = 0.4;

/** TTL categories (ISO 8601 duration strings) per IDEA.xml §8 */
export const DATA_TTL = {
  FAST_MOVING_MARKETPLACE_PRICE: 'PT4H',
  COMPETITION_SELLER_COUNT: 'PT12H',
  SUPPLIER_TIER_PRICE: 'P3D',
  SUPPLIER_IDENTITY_VERIFICATION: 'P30D',
  MARKETPLACE_FEE_STRUCTURE: 'P14D',
} as const;

/** Hard safety rule thresholds */
export const PROFIT_RECALC_TOLERANCE_IDR = 0.0001; // IDR 0.0001 — double-entry must match within this

/** Opportunity quality tiers */
export const QUALITY_TIERS = {
  S: 'S-TIER',
  A: 'A-TIER',
  B: 'B-TIER',
  C: 'C-TIER',
  REJECTED: 'REJECTED',
} as const;

/** Validation gate results */
export const GATE_RESULTS = {
  PASS: 'PASS',
  CRITICAL_FAIL: 'CRITICAL_FAIL',
  CRITICAL_UNKNOWN: 'CRITICAL_UNKNOWN',
  WARNING_NON_CRITICAL: 'WARNING_NON_CRITICAL',
} as const;
