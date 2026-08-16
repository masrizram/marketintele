/**
 * Observability Tests — Health endpoints + Metrics (Phase 7)
 *
 * IDEA §49 / AUDIT §50 require:
 *   /live, /ready, /health endpoints
 *   pipeline_runs_total, pipeline_success_total, pipeline_failure_total
 *   pipeline_duration_seconds, adapter_requests_total, adapter_failures_total
 *   supplier_resolution_total, opportunities_discovered/rejected/verified_total
 *   database_errors_total, circuit_breaker_trips_total
 *   correlation IDs in logs
 *
 * These tests verify the metrics registry and health endpoint functions.
 */
import { metricsRegistry, recordPipelineRun, recordOpportunityDecision, recordAdapterRequest, recordAdapterFailure } from './metrics';
import { getLivenessStatus, getHealthStatus, getReadinessStatus } from './health';

describe('Metrics Registry (Phase 7)', () => {
  it('registers all required metrics', () => {
    const required = [
      'pipeline_runs_total',
      'pipeline_success_total',
      'pipeline_failure_total',
      'pipeline_duration_seconds',
      'adapter_requests_total',
      'adapter_failures_total',
      'supplier_resolution_total',
      'opportunities_discovered_total',
      'opportunities_rejected_total',
      'opportunities_verified_total',
      'database_errors_total',
      'circuit_breaker_trips_total',
    ];
    for (const name of required) {
      expect(metricsRegistry.getCounter(name)).toBeDefined();
    }
  });

  it('pipeline_runs_total increments on recordPipelineRun', () => {
    const before = metricsRegistry.getCounter('pipeline_runs_total');
    recordPipelineRun(true, 0.5);
    expect(metricsRegistry.getCounter('pipeline_runs_total')).toBe(before + 1);
  });

  it('pipeline_success_total increments on success', () => {
    const before = metricsRegistry.getCounter('pipeline_success_total');
    recordPipelineRun(true, 0.1);
    expect(metricsRegistry.getCounter('pipeline_success_total')).toBe(before + 1);
  });

  it('pipeline_failure_total increments on failure', () => {
    const before = metricsRegistry.getCounter('pipeline_failure_total');
    recordPipelineRun(false, 0.1);
    expect(metricsRegistry.getCounter('pipeline_failure_total')).toBe(before + 1);
  });

  it('pipeline_duration_seconds records observations', () => {
    recordPipelineRun(true, 1.5);
    const hist = metricsRegistry.getHistogram('pipeline_duration_seconds');
    expect(hist).toBeDefined();
    expect(hist!.count).toBeGreaterThan(0);
  });

  it('recordOpportunityDecision increments correct counter', () => {
    const rejectBefore = metricsRegistry.getCounter('opportunities_rejected_total');
    const verifiedBefore = metricsRegistry.getCounter('opportunities_verified_total');
    recordOpportunityDecision('REJECT');
    recordOpportunityDecision('RECOMMEND');
    expect(metricsRegistry.getCounter('opportunities_rejected_total')).toBe(rejectBefore + 1);
    expect(metricsRegistry.getCounter('opportunities_verified_total')).toBe(verifiedBefore + 1);
  });

  it('adapter_requests_total records with labels', () => {
    recordAdapterRequest('ShopeeAdapter', '200');
    recordAdapterRequest('ShopeeAdapter', '429');
    expect(metricsRegistry.getLabeledCounter('adapter_requests_total', { adapter: 'ShopeeAdapter', status: '200' })).toBeGreaterThan(0);
    expect(metricsRegistry.getLabeledCounter('adapter_requests_total', { adapter: 'ShopeeAdapter', status: '429' })).toBeGreaterThan(0);
  });

  it('adapter_failures_total records with labels', () => {
    recordAdapterFailure('TokopediaAdapter', 'timeout');
    expect(metricsRegistry.getLabeledCounter('adapter_failures_total', { adapter: 'TokopediaAdapter', error_type: 'timeout' })).toBeGreaterThan(0);
  });

  it('toPrometheusText produces valid format', () => {
    const text = metricsRegistry.toPrometheusText();
    expect(text).toContain('# TYPE pipeline_runs_total counter');
    expect(text).toContain('pipeline_runs_total');
    expect(text).toContain('# TYPE pipeline_duration_seconds histogram');
    expect(text).toContain('pipeline_duration_seconds_count');
  });

  it('histogram getPercentile returns 0 when no observations', () => {
    const hist = metricsRegistry.registerHistogram('test_empty_hist', 'test', [0.1, 0.5, 1]);
    expect(hist.getPercentile(0.5)).toBe(0);
  });

  it('histogram getPercentile returns bucket boundary', () => {
    const hist = metricsRegistry.registerHistogram('test_pct_hist', 'test', [0.1, 0.5, 1]);
    hist.observe(0.05);
    hist.observe(0.2);
    hist.observe(0.8);
    expect(hist.count).toBe(3);
    expect(hist.getPercentile(0.5)).toBeGreaterThan(0);
  });
});

describe('Health Endpoints (Phase 7)', () => {
  it('getLivenessStatus returns alive with uptime', () => {
    const status = getLivenessStatus();
    expect(status.status).toBe('alive');
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.timestamp).toBeDefined();
  });

  it('getHealthStatus returns status with checks', async () => {
    const status = await getHealthStatus();
    expect(['healthy', 'degraded', 'unhealthy']).toContain(status.status);
    expect(status.checks).toBeDefined();
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.version).toBeDefined();
    expect(status.timestamp).toBeDefined();
  });

  it('getHealthStatus does not leak secrets', async () => {
    const status = await getHealthStatus();
    const json = JSON.stringify(status);
    expect(json).not.toMatch(/password|token|secret|apikey/i);
  });

  it('getReadinessStatus returns ready or not_ready', async () => {
    const status = await getReadinessStatus();
    expect(['ready', 'not_ready']).toContain(status.status);
    expect(status.dependencies).toBeDefined();
    expect(status.timestamp).toBeDefined();
  });

  it('getReadinessStatus includes postgres dependency', async () => {
    const status = await getReadinessStatus();
    expect(status.dependencies.postgresql).toBeDefined();
    expect(typeof status.dependencies.postgresql.ready).toBe('boolean');
  });

  it('getReadinessStatus includes adapters dependency', async () => {
    const status = await getReadinessStatus();
    expect(status.dependencies.adapters).toBeDefined();
    expect(typeof status.dependencies.adapters.ready).toBe('boolean');
  });
});
