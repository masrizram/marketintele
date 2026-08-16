/**
 * Landed-Cost Configuration Model
 *
 * IDEA.md §21 / AUDIT §19 require every landed-cost component to have:
 *   value, source, confidence, effective_from, effective_until,
 *   configuration_version.
 *
 * Hardcoded magic numbers in business logic are PROHIBITED.  This module
 * centralises all landed-cost assumptions into a single versioned, auditable
 * configuration that can be overridden via environment variables or replaced
 * with verified supplier quotations.
 *
 * UNKNOWN components (e.g. inbound logistics without a freight quote) are
 * represented as `null` — they are NEVER silently converted to zero
 * (UNKNOWN != ZERO per IDEA §7.1).
 */
import Decimal from 'decimal.js';
import { D } from './decimal-engine';

/**
 * A single configurable cost component with full provenance.
 */
export interface CostComponentConfig {
  /** Rate (fraction of supplier base cost) when `isRate`; flat IDR when `!isRate`. */
  value: number | null;
  isRate: boolean;
  /** Human-readable provenance — must state ESTIMATE / VERIFIED / UNCONFIRMED. */
  source: string;
  sourceTier: 1 | 2 | 3 | 4 | 5 | 6;
  confidence: number; // 0-1
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  configurationVersion: string;
}

/**
 * Complete, versioned landed-cost configuration.
 */
export interface LandedCostConfig {
  configurationVersion: string;
  // Rate-based components (fraction of supplier base cost)
  valueAddedTaxRate: CostComponentConfig;
  importDutiesRate: CostComponentConfig;
  wastageAndDefectRate: CostComponentConfig;
  supplierPaymentProcessingRate: CostComponentConfig;
  // Flat-fee components (IDR per unit / per shipment line)
  customsClearanceFee: CostComponentConfig;
  inboundPackagingFee: CostComponentConfig;
  qualityInspectionFee: CostComponentConfig;
  handlingWarehousingFee: CostComponentConfig;
  evidence: {
    source: string;
    observedAt: Date;
    confidence: number;
  };
}

/**
 * Build the default landed-cost configuration.
 *
 * Every value here is an EXPLICITLY-LABELLED ESTIMATE with LOW confidence
 * (sourceTier 5-6).  They are NOT verified supplier quotations.  Each can be
 * overridden via environment variables so operators can inject verified data.
 *
 * This function exists so that the assumptions are:
 *   - documented (source strings state "ESTIMATE")
 *   - configurable (callers pass overrides)
 *   - versioned (configurationVersion)
 *   - auditable (full provenance per component)
 */
export function buildLandedCostConfig(overrides?: Partial<Record<keyof Omit<LandedCostConfig, 'evidence' | 'configurationVersion'>, number | null>>): LandedCostConfig {
  const cfg: LandedCostConfig = {
    configurationVersion: '1.0.0',
    valueAddedTaxRate: {
      value: overrides?.valueAddedTaxRate ?? 0.11,
      isRate: true,
      source: 'ESTIMATE — Indonesia PPN 11% (consumer goods); verify against actual HS code / NPWP',
      sourceTier: 5,
      confidence: 0.5,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    importDutiesRate: {
      value: overrides?.importDutiesRate ?? 0,
      isRate: true,
      source: 'ESTIMATE — 0% default for many consumer electronics; MUST verify per HS code via Insw.navigator.id',
      sourceTier: 5,
      confidence: 0.4,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    wastageAndDefectRate: {
      value: overrides?.wastageAndDefectRate ?? 0.02,
      isRate: true,
      source: 'ESTIMATE — 2% wastage/defect reserve; replace with verified defect history',
      sourceTier: 6,
      confidence: 0.35,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    supplierPaymentProcessingRate: {
      value: overrides?.supplierPaymentProcessingRate ?? 0.029,
      isRate: true,
      source: 'ESTIMATE — 2.9% international wire/escrow; verify per payment method',
      sourceTier: 5,
      confidence: 0.45,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    customsClearanceFee: {
      value: overrides?.customsClearanceFee ?? 25000,
      isRate: false,
      source: 'ESTIMATE — Rp25,000 customs clearance admin fee; verify per forwarder',
      sourceTier: 6,
      confidence: 0.35,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    inboundPackagingFee: {
      value: overrides?.inboundPackagingFee ?? 10000,
      isRate: false,
      source: 'ESTIMATE — Rp10,000 inbound packaging per unit; verify per product',
      sourceTier: 6,
      confidence: 0.3,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    qualityInspectionFee: {
      value: overrides?.qualityInspectionFee ?? 100000,
      isRate: false,
      source: 'ESTIMATE — Rp100,000 QC inspection per shipment line; verify per inspector',
      sourceTier: 6,
      confidence: 0.3,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    handlingWarehousingFee: {
      value: overrides?.handlingWarehousingFee ?? 15000,
      isRate: false,
      source: 'ESTIMATE — Rp15,000 handling/warehousing per unit; verify per warehouse',
      sourceTier: 6,
      confidence: 0.3,
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: null,
      configurationVersion: '1.0.0',
    },
    evidence: {
      source: 'ESTIMATED landed-cost configuration v1.0.0 — NOT verified supplier quotations',
      observedAt: new Date(),
      confidence: 0.4,
    },
  };
  return cfg;
}

/**
 * Resolve landed-cost components from a configuration + supplier base cost.
 *
 * Rate components are applied to `supplierBaseCost`.  Flat components are used
 * directly.  A component whose config `value` is `null` (unconfigured/unknown)
 * produces a `null` Decimal — causing `computeLandedCost` to fail closed.
 */
export function resolveLandedCostComponents(
  supplierBaseCost: Decimal,
  cfg: LandedCostConfig,
): {
  inboundLogistics: Decimal | null;
  importDutiesTariffs: Decimal | null;
  valueAddedTax: Decimal | null;
  customsClearance: Decimal | null;
  supplierPaymentProcessingFee: Decimal | null;
  inboundPackagingMaterials: Decimal | null;
  qualityInspectionCost: Decimal | null;
  wastageAndDefectReserve: Decimal | null;
  handlingWarehousingInbound: Decimal | null;
} {
  const applyRate = (c: CostComponentConfig): Decimal | null => {
    if (c.value === null || c.value === undefined) return null;
    return supplierBaseCost.times(D(c.value));
  };
  const applyFlat = (c: CostComponentConfig): Decimal | null => {
    if (c.value === null || c.value === undefined) return null;
    return D(c.value);
  };

  return {
    // Inbound logistics (shipping) is NEVER estimated — it requires a real
    // freight quote.  This stays null until a verified shipping cost is supplied.
    inboundLogistics: null,
    importDutiesTariffs: applyRate(cfg.importDutiesRate),
    valueAddedTax: applyRate(cfg.valueAddedTaxRate),
    customsClearance: applyFlat(cfg.customsClearanceFee),
    supplierPaymentProcessingFee: applyRate(cfg.supplierPaymentProcessingRate),
    inboundPackagingMaterials: applyFlat(cfg.inboundPackagingFee),
    qualityInspectionCost: applyFlat(cfg.qualityInspectionFee),
    wastageAndDefectReserve: applyRate(cfg.wastageAndDefectRate),
    handlingWarehousingInbound: applyFlat(cfg.handlingWarehousingFee),
  };
}
