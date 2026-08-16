/**
 * Benchmark Harness Tests
 *
 * Verifies the benchmark harness:
 *   - runs without errors
 *   - returns p50/p95/p99 values
 *   - measures CPU and memory
 *   - handles concurrency levels 1 and 10
 *   - each stage benchmark returns non-negative duration
 *
 * Kept fast by using small iteration counts (20) and only concurrency 1 & 10.
 */
import {
  runBenchmark,
  printReport,
  BenchmarkReport,
  StageMetrics,
} from './benchmark';

const FAST_OPTIONS = {
  iterations: 20,
  concurrencyLevels: [1, 10],
};

function getAllStageMetrics(report: BenchmarkReport): StageMetrics[] {
  return report.stages;
}

describe('Benchmark harness', () => {
  let report: BenchmarkReport;

  beforeAll(async () => {
    report = await runBenchmark(FAST_OPTIONS);
  }, 120000);

  it('should run without errors and return a report', () => {
    expect(report).toBeDefined();
    expect(report).not.toBeNull();
    expect(report.timestamp).toBeTruthy();
    expect(report.nodeVersion).toMatch(/^v/);
    expect(report.platform).toBeTruthy();
  });

  it('should include p50, p95, and p99 values for every stage metric', () => {
    const all = getAllStageMetrics(report);
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m).toHaveProperty('p50Ns');
      expect(m).toHaveProperty('p95Ns');
      expect(m).toHaveProperty('p99Ns');
      expect(typeof m.p50Ns).toBe('number');
      expect(typeof m.p95Ns).toBe('number');
      expect(typeof m.p99Ns).toBe('number');
    }
  });

  it('should measure CPU usage (user and system deltas)', () => {
    const all = getAllStageMetrics(report);
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.cpuDelta).toBeDefined();
      expect(typeof m.cpuDelta.user).toBe('number');
      expect(typeof m.cpuDelta.system).toBe('number');
      // CPU deltas are cumulative process-level diffs; they may be 0 on fast
      // stages but should always be finite numbers.
      expect(Number.isFinite(m.cpuDelta.user)).toBe(true);
      expect(Number.isFinite(m.cpuDelta.system)).toBe(true);
    }
  });

  it('should measure memory usage (rss, heapUsed, heapTotal deltas)', () => {
    const all = getAllStageMetrics(report);
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.memoryDelta).toBeDefined();
      expect(typeof m.memoryDelta.rss).toBe('number');
      expect(typeof m.memoryDelta.heapUsed).toBe('number');
      expect(typeof m.memoryDelta.heapTotal).toBe('number');
      // Memory deltas can be negative (GC) but must be finite.
      expect(Number.isFinite(m.memoryDelta.rss)).toBe(true);
      expect(Number.isFinite(m.memoryDelta.heapUsed)).toBe(true);
      expect(Number.isFinite(m.memoryDelta.heapTotal)).toBe(true);
    }
  });

  it('should handle concurrency levels 1 and 10', () => {
    const concurrencyLevels = report.concurrencyLevels;
    expect(concurrencyLevels).toContain(1);
    expect(concurrencyLevels).toContain(10);

    const stagesAt1 = report.stages.filter((s) => s.concurrency === 1);
    const stagesAt10 = report.stages.filter((s) => s.concurrency === 10);
    expect(stagesAt1.length).toBeGreaterThan(0);
    expect(stagesAt10.length).toBeGreaterThan(0);
  });

  it('should return non-negative duration for each stage benchmark', () => {
    const all = getAllStageMetrics(report);
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.p50Ns).toBeGreaterThanOrEqual(0);
      expect(m.p95Ns).toBeGreaterThanOrEqual(0);
      expect(m.p99Ns).toBeGreaterThanOrEqual(0);
      expect(m.minNs).toBeGreaterThanOrEqual(0);
      expect(m.maxNs).toBeGreaterThanOrEqual(0);
      expect(m.meanNs).toBeGreaterThanOrEqual(0);
      expect(m.totalDurationNs).toBeGreaterThanOrEqual(0);
    }
  });

  it('should benchmark all expected stages', () => {
    const stageNames = new Set(report.stages.map((s) => s.stage));
    const expected = [
      'discovery',
      'matching',
      'supplierSourcing',
      'economics',
      'intelligence',
      'decision',
      'fullPipeline',
    ];
    for (const name of expected) {
      expect(stageNames.has(name)).toBe(true);
    }
  });

  it('should produce iterations count equal to the requested value', () => {
    for (const m of report.stages) {
      expect(m.iterations).toBe(FAST_OPTIONS.iterations);
    }
    expect(report.iterationCount).toBe(FAST_OPTIONS.iterations);
  });

  it('should print a formatted report without throwing', () => {
    expect(() => {
      // Suppress console output during the test by capturing it.
      const originalLog = console.log;
      const originalError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        printReport(report);
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }
    }).not.toThrow();
  });

  it('should report non-negative throughput', () => {
    for (const m of report.stages) {
      expect(m.throughputOpsPerSec).toBeGreaterThanOrEqual(0);
    }
  });
});
