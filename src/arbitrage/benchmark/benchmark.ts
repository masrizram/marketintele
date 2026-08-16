/**
 * Arbitrage Pipeline Performance Benchmark Harness
 *
 * Measures per-stage and full-pipeline performance using REAL measurements
 * (process.hrtime.bigint(), Date.now(), process.cpuUsage, process.memoryUsage).
 * Deterministic mock data (same pattern as pipeline.e2e.test.ts) is used as
 * benchmark input so results are reproducible across runs.
 *
 * Stages benchmarked:
 *   - discovery (mock)
 *   - matching
 *   - supplier sourcing (TEST_FIXTURE)
 *   - economics
 *   - intelligence (market-clearing + demand + competition + risk + EV + decay)
 *   - decision
 *   - full pipeline
 *
 * Concurrency levels: 1, 10, 50, 100
 *
 * The harness DOES NOT fabricate results — every duration is an actual
 * wall-clock measurement of the function under test.
 */
import 'dotenv/config';
import { ulid } from 'ulid';
import * as crypto from 'crypto';

import { CanonicalProduct } from '../types';
import { matchProduct } from '../pipeline/matching';
import { computeEconomics } from '../pipeline/economics';
import { assessRisk, RiskInput } from '../pipeline/risk';
import { decideOpportunity } from '../pipeline/decision';
import { ArbitragePipeline } from '../pipeline/pipeline';
import { discoveryService } from '../pipeline/discovery';
import { supplierSourcingService } from '../sourcing/supplier-sourcing-service';
import { TestFixtureSupplierAdapter } from '../sourcing/test-fixture-supplier-adapter';

import { computeMarketClearingPrice, MarketListing } from '../intelligence/market-clearing';
import { assessDemand } from '../intelligence/demand';
import { assessCompetition } from '../intelligence/competition';
import { computeOpportunityDecay } from '../intelligence/opportunity-decay';
import { computeExpectedValue, buildDefaultScenarioProbabilities } from '../intelligence/expected-value';
import { assessComprehensiveRisk } from '../intelligence/risk-assessment';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StageMetrics {
  stage: string;
  iterations: number;
  concurrency: number;
  p50Ns: number;
  p95Ns: number;
  p99Ns: number;
  minNs: number;
  maxNs: number;
  meanNs: number;
  /** Operations per second (1e9 ns/s). */
  throughputOpsPerSec: number;
  totalDurationNs: number;
  cpuDelta: { user: number; system: number };
  memoryDelta: { rss: number; heapUsed: number; heapTotal: number };
}

export interface BenchmarkReport {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  stages: StageMetrics[];
  iterationCount: number;
  concurrencyLevels: number[];
}

export interface BenchmarkOptions {
  iterations?: number;
  concurrencyLevels?: number[];
}

// ─── Deterministic Mock Fixtures ─────────────────────────────────────────────
// Same pattern as pipeline.e2e.test.ts — deterministic data, no randomness.

const FIXED_TIMESTAMP = '2024-01-15T10:00:00.000Z';

function buildDeterministicProduct(): CanonicalProduct {
  return {
    id: ulid(),
    canonicalTitle: 'Power Bank 10000mAh PD 30W Fast Charging',
    brand: 'TechBrand',
    model: 'PB-10K-PD30W',
    categoryId: '107',
    standardUnit: 'pcs',
    standardWeightGrams: 250,
    standardDimensionsCm: '10x5x2',
    sku: 'PB-10K-PD30W',
    barcode: '8888123456789',
    priceInIdr: 249999,
    currencyConverted: true,
    moq: 1,
    packageQuantity: 1,
    packageUnit: 'pcs',
    sourceId: 'shopee',
    supplierProductId: null,
    marketplaceListingId: null,
    sellerId: '123456789',
    sellerName: 'TechGadget Official',
    marketplaceListingUrl: 'https://shopee.co.id/power-bank-10000mah-i.123456789.12345678901',
    observedAt: FIXED_TIMESTAMP,
    confidence: 0.9,
    dataLineage: {
      sourceId: 'shopee',
      rawDocumentId: ulid(),
      rawEvidenceHash: crypto.createHash('sha256').update('benchmark-fixture').digest('hex'),
      extractionMethod: 'mock-benchmark-parser',
      observedAt: FIXED_TIMESTAMP,
      confidence: 0.9,
      evidenceHierarchyLevel: 3,
    },
  };
}

function buildDeterministicListings(product: CanonicalProduct): MarketListing[] {
  const prices = [249999, 259000, 245000, 255000, 250500, 252000, 248000, 251000, 246500, 253500];
  return prices.map((price, i) => ({
    listingId: `listing_${i}`,
    sellerId: `seller_${i % 5}`,
    sellerName: `Seller ${i % 5}`,
    price,
    originalPrice: null,
    rating: 4.5 + (i % 5) * 0.1,
    reviewCount: 100 + i * 50,
    soldCount: 50 + i * 10,
    stock: 100,
    title: product.canonicalTitle,
    observedAt: FIXED_TIMESTAMP,
    sourceUrl: `https://shopee.co.id/listing_${i}`,
  }));
}

// ─── Mock Discovery (same approach as e2e test) ──────────────────────────────

let discoveryInstalled = false;
let originalDiscover: typeof discoveryService.discover | null = null;

function installMockDiscovery(): void {
  if (discoveryInstalled) return;
  originalDiscover = discoveryService.discover.bind(discoveryService);
  const product = buildDeterministicProduct();
  discoveryService.discover = async (context, query, marketplace, _timeout) => {
    return {
      requestId: context.requestId,
      status: 'SUCCESS' as const,
      marketplace: marketplace || 'shopee',
      query,
      products: [product],
      error: null,
      metadata: {
        adapterName: 'BenchmarkMockAdapter',
        sourceUrl: 'https://shopee.co.id',
        elapsedMs: 0,
        observedAt: FIXED_TIMESTAMP,
      },
    };
  };
  discoveryInstalled = true;
}

function restoreDiscovery(): void {
  if (originalDiscover && discoveryInstalled) {
    discoveryService.discover = originalDiscover;
    discoveryInstalled = false;
    originalDiscover = null;
  }
}

// ─── Measurement Helpers ─────────────────────────────────────────────────────

const NS_PER_SEC = 1_000_000_000;

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(ns: number): number {
  return ns / 1_000_000;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const frac = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * frac;
}

interface ResourceSnapshot {
  cpu: { user: number; system: number };
  memory: { rss: number; heapUsed: number; heapTotal: number };
}

function snapshotResources(): ResourceSnapshot {
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  return {
    cpu: { user: cpu.user, system: cpu.system },
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
  };
}

function diffResources(before: ResourceSnapshot, after: ResourceSnapshot) {
  return {
    cpu: {
      user: after.cpu.user - before.cpu.user,
      system: after.cpu.system - before.cpu.system,
    },
    memory: {
      rss: after.memory.rss - before.memory.rss,
      heapUsed: after.memory.heapUsed - before.memory.heapUsed,
      heapTotal: after.memory.heapTotal - before.memory.heapTotal,
    },
  };
}

// ─── Stage Executors ─────────────────────────────────────────────────────────
// Each executor is a synchronous or async function that performs ONE unit of
// stage work.  The harness calls it repeatedly and measures each invocation.

type StageExecutor = () => void | Promise<void>;

function buildStageExecutors(): Record<string, StageExecutor> {
  const product = buildDeterministicProduct();
  const listings = buildDeterministicListings(product);

  // Pre-compute once so the decision/economics stages have stable inputs
  // (mirrors what the full pipeline would feed them).
  const marketplace = 'shopee';
  const sellingPriceIdr = 250000; // P25-ish clearing price for the fixture
  const supplierPriceIdr = Math.round(249999 * 0.4); // TEST_FIXTURE wholesale
  const supplierMoq = 50;
  const shippingCostIdr = 15000;

  return {
    discovery: async () => {
      const ctx = {
        requestId: 'req_bench',
        correlationId: 'corr_bench',
        userId: 1,
        query: 'power bank 10000mah',
        requestedAt: FIXED_TIMESTAMP,
      };
      await discoveryService.discover(ctx, 'power bank 10000mah', 'shopee', 5000);
    },

    matching: () => {
      matchProduct(product, [product], 0.3);
    },

    supplierSourcing: async () => {
      await supplierSourcingService.searchSuppliers('power bank 10000mah', product);
    },

    economics: () => {
      computeEconomics(
        product,
        marketplace,
        sellingPriceIdr,
        supplierPriceIdr,
        supplierMoq,
        shippingCostIdr,
        'req_bench',
      );
    },

    intelligence: () => {
      // market-clearing
      computeMarketClearingPrice(listings);
      // demand
      assessDemand({
        soldCount: 500,
        reviewCount: 1250,
        reviewVelocity: 3,
        ranking: 5,
        listingGrowth: 10,
        sellerCount: 5,
        historicalPriceObservations: [245000, 249000, 251000],
        observedAt: FIXED_TIMESTAMP,
      });
      // competition
      assessCompetition({
        listings,
        priceChangeFrequency: 2,
        recentUndercutCount: 1,
        observedAt: FIXED_TIMESTAMP,
      });
      // decay
      computeOpportunityDecay({
        discoveredAt: FIXED_TIMESTAMP,
        lastPriceObservedAt: FIXED_TIMESTAMP,
        lastSupplierVerifiedAt: FIXED_TIMESTAMP,
        now: FIXED_TIMESTAMP,
        halfLifeHours: 24,
        priceChangeVelocity: null,
        supplierPriceChangeVelocity: null,
        competitionChangeVelocity: null,
        marketPriceTtlHours: 4,
        supplierPriceTtlHours: 72,
      });
      // risk assessment (pipeline-level)
      const fixtureEconomics = computeEconomics(
        product,
        marketplace,
        sellingPriceIdr,
        supplierPriceIdr,
        supplierMoq,
        shippingCostIdr,
        'req_bench',
      );
      const fixtureSupplier = {
        id: 'fixture_supplier_001',
        name: '[TEST_FIXTURE] Shenzhen Electronics Co., Ltd.',
        type: 'MANUFACTURER' as const,
        sourceUrl: 'https://example-fixture.com',
        sourcePriceIdr: supplierPriceIdr,
        moq: supplierMoq,
        shippingCostIdr: shippingCostIdr,
        contactInfo: null,
        evidence: 'TEST_FIXTURE',
        confidence: 'PARTIALLY_VERIFIED' as const,
        confidenceScore: 0.5,
        observedAt: FIXED_TIMESTAMP,
      };
      const riskInput: RiskInput = {
        product,
        supplier: fixtureSupplier,
        economics: fixtureEconomics,
        marketplace,
        listingAgeHours: null,
        requestId: 'req_bench',
      };
      const riskResult = assessRisk(riskInput);

      // comprehensive risk
      const demandResult = assessDemand({
        soldCount: 500,
        reviewCount: 1250,
        reviewVelocity: 3,
        ranking: 5,
        listingGrowth: 10,
        sellerCount: 5,
        historicalPriceObservations: [245000, 249000, 251000],
        observedAt: FIXED_TIMESTAMP,
      });
      const competitionResult = assessCompetition({
        listings,
        priceChangeFrequency: 2,
        recentUndercutCount: 1,
        observedAt: FIXED_TIMESTAMP,
      });
      const decayResult = computeOpportunityDecay({
        discoveredAt: FIXED_TIMESTAMP,
        lastPriceObservedAt: FIXED_TIMESTAMP,
        lastSupplierVerifiedAt: FIXED_TIMESTAMP,
        now: FIXED_TIMESTAMP,
        halfLifeHours: 24,
        priceChangeVelocity: null,
        supplierPriceChangeVelocity: null,
        competitionChangeVelocity: null,
        marketPriceTtlHours: 4,
        supplierPriceTtlHours: 72,
      });
      assessComprehensiveRisk({
        product,
        supplier: fixtureSupplier,
        economics: fixtureEconomics,
        demand: demandResult,
        competition: competitionResult,
        decay: decayResult,
        marketplace,
        requestId: 'req_bench',
      });

      // expected value
      if (
        fixtureEconomics.profitCalculation &&
        fixtureEconomics.profitCalculation.primaryResult.netProfitPerUnit.gt(0)
      ) {
        const netProfit =
          fixtureEconomics.profitCalculation.primaryResult.netProfitPerUnit.toNumber();
        const capitalLoss = fixtureEconomics.landedCost ?? 0;
        const baseSuccessProb = Math.max(
          0.05,
          Math.min(0.9, riskResult.confidenceScore * 0.7),
        );
        const scenarioProbs = buildDefaultScenarioProbabilities(baseSuccessProb);
        computeExpectedValue({
          successProfit: netProfit,
          failureCapitalLoss: capitalLoss,
          successProbability: scenarioProbs[1],
          scenarios: {
            probabilities: scenarioProbs,
            payoffs: [
              { scenario: 'BEAR', netProfit: Math.round(netProfit * 0.3), capitalLoss },
              { scenario: 'BASE', netProfit, capitalLoss: 0 },
              { scenario: 'BULL', netProfit: Math.round(netProfit * 1.5), capitalLoss: 0 },
            ],
          },
        });
      }
    },

    decision: () => {
      const fixtureEconomics = computeEconomics(
        product,
        marketplace,
        sellingPriceIdr,
        supplierPriceIdr,
        supplierMoq,
        shippingCostIdr,
        'req_bench',
      );
      const fixtureSupplier = {
        id: 'fixture_supplier_001',
        name: '[TEST_FIXTURE] Shenzhen Electronics Co., Ltd.',
        type: 'MANUFACTURER' as const,
        sourceUrl: 'https://example-fixture.com',
        sourcePriceIdr: supplierPriceIdr,
        moq: supplierMoq,
        shippingCostIdr: shippingCostIdr,
        contactInfo: null,
        evidence: 'TEST_FIXTURE',
        confidence: 'PARTIALLY_VERIFIED' as const,
        confidenceScore: 0.5,
        observedAt: FIXED_TIMESTAMP,
      };
      const riskResult = assessRisk({
        product,
        supplier: fixtureSupplier,
        economics: fixtureEconomics,
        marketplace,
        listingAgeHours: null,
        requestId: 'req_bench',
      });
      const compRisk = assessComprehensiveRisk({
        product,
        supplier: fixtureSupplier,
        economics: fixtureEconomics,
        demand: assessDemand({
          soldCount: 500,
          reviewCount: 1250,
          reviewVelocity: 3,
          ranking: 5,
          listingGrowth: 10,
          sellerCount: 5,
          historicalPriceObservations: [245000, 249000, 251000],
          observedAt: FIXED_TIMESTAMP,
        }),
        competition: assessCompetition({
          listings,
          priceChangeFrequency: 2,
          recentUndercutCount: 1,
          observedAt: FIXED_TIMESTAMP,
        }),
        decay: computeOpportunityDecay({
          discoveredAt: FIXED_TIMESTAMP,
          lastPriceObservedAt: FIXED_TIMESTAMP,
          lastSupplierVerifiedAt: FIXED_TIMESTAMP,
          now: FIXED_TIMESTAMP,
          halfLifeHours: 24,
          priceChangeVelocity: null,
          supplierPriceChangeVelocity: null,
          competitionChangeVelocity: null,
          marketPriceTtlHours: 4,
          supplierPriceTtlHours: 72,
        }),
        marketplace,
        requestId: 'req_bench',
      });
      decideOpportunity({
        product,
        marketplace,
        economics: fixtureEconomics,
        risk: {
          ...riskResult,
          overallRisk: compRisk.overallRisk,
          confidenceScore: compRisk.confidenceScore,
        },
        requestId: 'req_bench',
        marketClearingPrice: computeMarketClearingPrice(listings),
        demand: assessDemand({
          soldCount: 500,
          reviewCount: 1250,
          reviewVelocity: 3,
          ranking: 5,
          listingGrowth: 10,
          sellerCount: 5,
          historicalPriceObservations: [245000, 249000, 251000],
          observedAt: FIXED_TIMESTAMP,
        }),
        competition: assessCompetition({
          listings,
          priceChangeFrequency: 2,
          recentUndercutCount: 1,
          observedAt: FIXED_TIMESTAMP,
        }),
        decay: computeOpportunityDecay({
          discoveredAt: FIXED_TIMESTAMP,
          lastPriceObservedAt: FIXED_TIMESTAMP,
          lastSupplierVerifiedAt: FIXED_TIMESTAMP,
          now: FIXED_TIMESTAMP,
          halfLifeHours: 24,
          priceChangeVelocity: null,
          supplierPriceChangeVelocity: null,
          competitionChangeVelocity: null,
          marketPriceTtlHours: 4,
          supplierPriceTtlHours: 72,
        }),
        expectedValue: null,
      });
    },

    fullPipeline: async () => {
      const pipeline = new ArbitragePipeline(5000);
      await pipeline.execute(1, 'power bank 10000mah', 'shopee');
    },
  };
}

// ─── Single-Stage Benchmark ──────────────────────────────────────────────────

async function runStage(
  stageName: string,
  executor: StageExecutor,
  iterations: number,
  concurrency: number,
): Promise<StageMetrics> {
  const before = snapshotResources();
  const durationsNs: number[] = [];
  durationsNs.length = iterations;

  // Run `iterations` invocations at the given concurrency level.
  // We use a worker-pool pattern: dispatch `concurrency` promises at a time,
  // each of which executes the executor once and records its own duration.
  let index = 0;

  async function worker(): Promise<void> {
    while (index < iterations) {
      const myIndex = index;
      index += 1;
      const start = nowNs();
      await executor();
      const end = nowNs();
      durationsNs[myIndex] = Number(end - start);
    }
  }

  const workers: Promise<void>[] = [];
  const poolSize = Math.min(concurrency, iterations);
  for (let i = 0; i < poolSize; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const after = snapshotResources();
  const resourceDiff = diffResources(before, after);

  durationsNs.sort((a, b) => a - b);

  const p50 = percentile(durationsNs, 50);
  const p95 = percentile(durationsNs, 95);
  const p99 = percentile(durationsNs, 99);
  const min = durationsNs[0];
  const max = durationsNs[durationsNs.length - 1];
  const sum = durationsNs.reduce((acc, v) => acc + v, 0);
  const mean = sum / durationsNs.length;
  // Throughput: iterations completed per second across the concurrency level.
  const totalDurationSec = sum / NS_PER_SEC;
  const throughput = totalDurationSec > 0 ? iterations / totalDurationSec : 0;

  return {
    stage: stageName,
    iterations,
    concurrency,
    p50Ns: Math.round(p50),
    p95Ns: Math.round(p95),
    p99Ns: Math.round(p99),
    minNs: Math.round(min),
    maxNs: Math.round(max),
    meanNs: Math.round(mean),
    throughputOpsPerSec: Math.round(throughput),
    totalDurationNs: Math.round(sum),
    cpuDelta: resourceDiff.cpu,
    memoryDelta: resourceDiff.memory,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Run the full benchmark suite and return a structured JSON report.
 *
 * @param options.iterations       Iterations per stage (default 100).
 * @param options.concurrencyLevels  Concurrency levels to test (default [1,10,50,100]).
 */
export async function runBenchmark(
  options: BenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const iterations = options.iterations ?? 100;
  const concurrencyLevels = options.concurrencyLevels ?? [1, 10, 50, 100];

  // Install the TEST_FIXTURE supplier adapter so the supplier-sourcing stage
  // has a deterministic adapter to exercise.
  supplierSourcingService.registerAdapter(new TestFixtureSupplierAdapter());

  // Install mock discovery for the discovery + fullPipeline stages.
  installMockDiscovery();

  try {
    const executors = buildStageExecutors();
    const stageNames = Object.keys(executors);
    const stageMetrics: StageMetrics[] = [];

    for (const stageName of stageNames) {
      const executor = executors[stageName];
      for (const concurrency of concurrencyLevels) {
        const metrics = await runStage(stageName, executor, iterations, concurrency);
        stageMetrics.push(metrics);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      stages: stageMetrics,
      iterationCount: iterations,
      concurrencyLevels,
    };
  } finally {
    restoreDiscovery();
  }
}

// ─── Report Printer ──────────────────────────────────────────────────────────

function fmtMs(ns: number): string {
  return `${nsToMs(ns).toFixed(3)} ms`;
}

function fmtBytes(bytes: number): string {
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  if (abs < 1024 * 1024 * 1024) return `${sign}${(abs / (1024 * 1024)).toFixed(1)} MB`;
  return `${sign}${(abs / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtCpu(microseconds: number): string {
  const sign = microseconds < 0 ? '-' : '';
  const abs = Math.abs(microseconds);
  if (abs < 1000) return `${sign}${abs} µs`;
  return `${sign}${(abs / 1000).toFixed(1)} ms`;
}

/**
 * Print a formatted benchmark report table to stdout.
 */
export function printReport(report: BenchmarkReport): void {
  const header = `Arbitrage Pipeline Benchmark Report`;
  const line = '='.repeat(header.length);

  console.log(line);
  console.log(header);
  console.log(line);
  console.log(`Timestamp:     ${report.timestamp}`);
  console.log(`Node:          ${report.nodeVersion}`);
  console.log(`Platform:     ${report.platform}`);
  console.log(`Iterations:    ${report.iterationCount} per stage`);
  console.log(`Concurrency:   ${report.concurrencyLevels.join(', ')}`);
  console.log('');

  for (const concurrency of report.concurrencyLevels) {
    const stageGroup = report.stages.filter((s) => s.concurrency === concurrency);
    if (stageGroup.length === 0) continue;

    console.log(`─ Concurrency ${concurrency} ${'─'.repeat(Math.max(0, 60 - 14 - String(concurrency).length))}`);

    const rows = stageGroup.map((m) => ({
      Stage: m.stage.padEnd(18),
      p50: fmtMs(m.p50Ns).padStart(12),
      p95: fmtMs(m.p95Ns).padStart(12),
      p99: fmtMs(m.p99Ns).padStart(12),
      mean: fmtMs(m.meanNs).padStart(12),
      'ops/s': String(m.throughputOpsPerSec).padStart(8),
      'CPU user': fmtCpu(m.cpuDelta.user).padStart(12),
      'CPU sys': fmtCpu(m.cpuDelta.system).padStart(12),
      'heap Δ': fmtBytes(m.memoryDelta.heapUsed).padStart(12),
    }));

    const headerRow =
      'Stage                ' +
      '          p50 ' +
      '          p95 ' +
      '          p99 ' +
      '         mean ' +
      '   ops/s' +
      '     CPU user ' +
      '     CPU sys ' +
      '      heap Δ';
    console.log(headerRow);
    console.log('-'.repeat(headerRow.length));

    for (const r of rows) {
      console.log(
        r.Stage +
          r.p50 +
          r.p95 +
          r.p99 +
          r.mean +
          r['ops/s'] +
          r['CPU user'] +
          r['CPU sys'] +
          r['heap Δ'],
      );
    }
    console.log('');
  }

  console.log(line);
  console.log('All measurements are real wall-clock time (process.hrtime.bigint).');
  console.log('CPU/memory deltas are process-level (process.cpuUsage / process.memoryUsage).');
  console.log(line);
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

// When run directly via `tsx`, execute the benchmark and print the report.
// Guarded so importing the module (e.g. in tests) does not auto-run.
if (require.main === module) {
  (async () => {
    const report = await runBenchmark();
    printReport(report);
  })().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exitCode = 1;
  });
}
