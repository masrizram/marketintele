/**
 * Metrics Registry — Prometheus-style counters and histograms.
 *
 * IDEA §49 / AUDIT §50 require metrics for:
 *   pipeline_runs_total, pipeline_success_total, pipeline_failure_total,
 *   pipeline_duration_seconds, adapter_requests_total, adapter_failures_total,
 *   supplier_resolution_total, opportunities_discovered_total,
 *   opportunities_rejected_total, opportunities_verified_total,
 *   database_errors_total, circuit_breaker_trips_total
 *
 * This is a lightweight in-process registry that exposes a Prometheus-compatible
 * text exposition format. No external dependencies.
 */

export type MetricType = 'counter' | 'histogram';

export interface MetricSample {
  name: string;
  type: MetricType;
  labels: Record<string, string>;
  value: number;
}

class Counter {
  constructor(
    readonly name: string,
    readonly help: string,
    private value = 0,
  ) {}

  inc(n: number = 1): void {
    this.value += n;
  }

  get(): number {
    return this.value;
  }
}

class LabeledCounter {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
    private values: Map<string, number> = new Map(),
  ) {}

  inc(labels: Record<string, string> = {}, n: number = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) || 0) + n);
  }

  get(labels: Record<string, string> = {}): number {
    return this.values.get(this.labelKey(labels)) || 0;
  }

  private labelKey(labels: Record<string, string>): string {
    return this.labelNames.map((l) => labels[l] || '').join('|');
  }
}

class Histogram {
  readonly buckets: number[];
  readonly counts: number[];
  sum = 0;
  count = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    buckets: number[] = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.counts = new Array(this.buckets.length + 1).fill(0);
  }

  observe(valueSeconds: number): void {
    this.sum += valueSeconds;
    this.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      if (valueSeconds <= this.buckets[i]) {
        this.counts[i]++;
        return;
      }
    }
    this.counts[this.counts.length - 1]++;
  }

  getPercentile(p: number): number {
    if (this.count === 0) return 0;
    const target = Math.ceil(this.count * p);
    let cumulative = 0;
    for (let i = 0; i < this.counts.length; i++) {
      cumulative += this.counts[i];
      if (cumulative >= target) {
        return i < this.buckets.length ? this.buckets[i] : this.buckets[this.buckets.length - 1];
      }
    }
    return this.buckets[this.buckets.length - 1];
  }
}

class MetricsRegistry {
  private counters = new Map<string, Counter>();
  private labeledCounters = new Map<string, LabeledCounter>();
  private histograms = new Map<string, Histogram>();

  registerCounter(name: string, help: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Counter(name, help));
    }
    return this.counters.get(name)!;
  }

  registerLabeledCounter(name: string, help: string, labelNames: string[]): LabeledCounter {
    if (!this.labeledCounters.has(name)) {
      this.labeledCounters.set(name, new LabeledCounter(name, help, labelNames));
    }
    return this.labeledCounters.get(name)!;
  }

  registerHistogram(name: string, help: string, buckets?: number[]): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Histogram(name, help, buckets));
    }
    return this.histograms.get(name)!;
  }

  inc(name: string, n: number = 1): void {
    this.counters.get(name)?.inc(n);
  }

  incLabeled(name: string, labels: Record<string, string>, n: number = 1): void {
    this.labeledCounters.get(name)?.inc(labels, n);
  }

  observe(name: string, valueSeconds: number): void {
    this.histograms.get(name)?.observe(valueSeconds);
  }

  getCounter(name: string): number {
    return this.counters.get(name)?.get() || 0;
  }

  getLabeledCounter(name: string, labels: Record<string, string> = {}): number {
    return this.labeledCounters.get(name)?.get(labels) || 0;
  }

  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(name);
  }

  /**
   * Export all metrics in Prometheus text exposition format.
   */
  toPrometheusText(): string {
    const lines: string[] = [];

    for (const [name, counter] of this.counters) {
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${counter.get()}`);
    }

    for (const [name, lc] of this.labeledCounters) {
      lines.push(`# HELP ${name} ${lc.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [key, value] of lc['values']) {
        const labels: string[] = [];
        const parts = key.split('|');
        lc.labelNames.forEach((labelName, i) => {
          if (parts[i]) labels.push(`${labelName}="${parts[i]}"`);
        });
        const labelStr = labels.length > 0 ? `{${labels.join(',')}}` : '';
        lines.push(`${name}${labelStr} ${value}`);
      }
    }

    for (const [name, hist] of this.histograms) {
      lines.push(`# HELP ${name} ${hist.help}`);
      lines.push(`# TYPE ${name} histogram`);
      let cumulative = 0;
      for (let i = 0; i < hist.buckets.length; i++) {
        cumulative += hist.counts[i];
        lines.push(`${name}_bucket{le="${hist.buckets[i]}"} ${cumulative}`);
      }
      cumulative += hist.counts[hist.counts.length - 1];
      lines.push(`${name}_bucket{le="+Inf"} ${cumulative}`);
      lines.push(`${name}_sum ${hist.sum}`);
      lines.push(`${name}_count ${hist.count}`);
    }

    return lines.join('\n') + '\n';
  }
}

// ── Singleton registry ──────────────────────────────────────────────────────
export const metricsRegistry = new MetricsRegistry();

// ── Register all required metrics (IDEA §49) ────────────────────────────────
metricsRegistry.registerCounter('pipeline_runs_total', 'Total number of pipeline runs');
metricsRegistry.registerCounter('pipeline_success_total', 'Number of successful pipeline runs');
metricsRegistry.registerCounter('pipeline_failure_total', 'Number of failed pipeline runs');
metricsRegistry.registerHistogram('pipeline_duration_seconds', 'Pipeline execution duration in seconds');
metricsRegistry.registerLabeledCounter('adapter_requests_total', 'Total adapter requests', ['adapter', 'status']);
metricsRegistry.registerLabeledCounter('adapter_failures_total', 'Total adapter failures', ['adapter', 'error_type']);
metricsRegistry.registerCounter('supplier_resolution_total', 'Total supplier resolution attempts');
metricsRegistry.registerCounter('opportunities_discovered_total', 'Total opportunities discovered');
metricsRegistry.registerCounter('opportunities_rejected_total', 'Total opportunities rejected by gates');
metricsRegistry.registerCounter('opportunities_verified_total', 'Total opportunities verified (RECOMMEND)');
metricsRegistry.registerCounter('database_errors_total', 'Total database errors');
metricsRegistry.registerCounter('circuit_breaker_trips_total', 'Total circuit breaker trips to OPEN');

// ── Convenience helpers ──────────────────────────────────────────────────────
export function recordPipelineRun(success: boolean, durationSeconds: number): void {
  metricsRegistry.inc('pipeline_runs_total');
  if (success) {
    metricsRegistry.inc('pipeline_success_total');
  } else {
    metricsRegistry.inc('pipeline_failure_total');
  }
  metricsRegistry.observe('pipeline_duration_seconds', durationSeconds);
}

export function recordAdapterRequest(adapter: string, status: string): void {
  metricsRegistry.incLabeled('adapter_requests_total', { adapter, status });
}

export function recordAdapterFailure(adapter: string, errorType: string): void {
  metricsRegistry.incLabeled('adapter_failures_total', { adapter, error_type: errorType });
}

export function recordOpportunityDecision(decision: string): void {
  if (decision === 'REJECT') {
    metricsRegistry.inc('opportunities_rejected_total');
  } else if (decision === 'RECOMMEND') {
    metricsRegistry.inc('opportunities_verified_total');
  }
}
