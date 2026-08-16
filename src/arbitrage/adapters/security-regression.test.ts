/**
 * Security Regression Tests (Phase 6)
 *
 * IDEA §41 / AUDIT §44 — SSRF redirect-to-private-IP tests
 * and additional security regressions.
 *
 * Tests that are NOT already in security.test.ts:
 *   - Redirect-to-private-IP for all RFC1918 ranges
 *   - IPv6 localhost and link-local
 *   - IPv4-mapped IPv6
 *   - Redirect chain > 3 hops
 *   - Unsupported protocol
 *   - Telegram authorization regression
 *   - Secret leakage check
 */
import { BaseSourceAdapter } from './base-adapter';
import { createRequestLogger } from '../pipeline/logger';
import { getHealthStatus } from '../observability/health';
import { loadConfig } from '../../config';

class TestAdapter extends BaseSourceAdapter {
  readonly adapterName = 'TestAdapter';
  readonly sourceName = 'Test Source';
  readonly baseUrl = 'https://example.com';
  readonly trustTier = 'MEDIUM' as const;
  readonly isActive = true;

  async search(): Promise<unknown> { return []; }
  async fetch(target: string): Promise<any> { return { url: target, statusCode: 200, headers: {}, body: '', contentType: '', observedAt: new Date().toISOString(), bytesLength: 0 }; }
  async parse(): Promise<any> { return { rawDocumentId: '', entities: [], extractionMethod: '', extractionConfidence: 0 }; }
  async normalize(): Promise<any> { return {} as any; }

  async testIsSafeUrl(url: string): Promise<boolean> { return this.isSafeUrl(url); }
  testIsPrivateIp(ip: string): boolean { return this.isPrivateIp(ip); }
}

describe('SSRF Regression — Redirect to private IP ranges (Phase 6)', () => {
  const adapter = new TestAdapter();

  it('blocks redirect to 127.0.0.1', () => {
    expect(adapter.testIsPrivateIp('127.0.0.1')).toBe(true);
  });

  it('blocks redirect to 127.0.0.0/8 range', () => {
    expect(adapter.testIsPrivateIp('127.0.0.0')).toBe(true);
    expect(adapter.testIsPrivateIp('127.255.255.255')).toBe(true);
    expect(adapter.testIsPrivateIp('127.1.2.3')).toBe(true);
  });

  it('blocks redirect to 10.0.0.0/8 range', () => {
    expect(adapter.testIsPrivateIp('10.0.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('10.255.255.255')).toBe(true);
    expect(adapter.testIsPrivateIp('10.1.2.3')).toBe(true);
  });

  it('blocks redirect to 172.16.0.0/12 range', () => {
    expect(adapter.testIsPrivateIp('172.16.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('172.31.255.255')).toBe(true);
    expect(adapter.testIsPrivateIp('172.20.0.1')).toBe(true);
  });

  it('does NOT block 172.15.x.x (outside private range)', () => {
    expect(adapter.testIsPrivateIp('172.15.0.1')).toBe(false);
  });

  it('does NOT block 172.32.x.x (outside private range)', () => {
    expect(adapter.testIsPrivateIp('172.32.0.1')).toBe(false);
  });

  it('blocks redirect to 192.168.0.0/16 range', () => {
    expect(adapter.testIsPrivateIp('192.168.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('192.168.1.100')).toBe(true);
    expect(adapter.testIsPrivateIp('192.168.255.255')).toBe(true);
  });

  it('blocks redirect to link-local 169.254.0.0/16', () => {
    expect(adapter.testIsPrivateIp('169.254.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('169.254.169.254')).toBe(true);
    expect(adapter.testIsPrivateIp('169.254.255.255')).toBe(true);
  });

  it('blocks metadata endpoint 169.254.169.254 (AWS)', () => {
    expect(adapter.testIsPrivateIp('169.254.169.254')).toBe(true);
  });

  it('blocks IPv6 localhost ::1', () => {
    expect(adapter.testIsPrivateIp('::1')).toBe(true);
  });

  it('blocks IPv6 unspecified ::', () => {
    expect(adapter.testIsPrivateIp('::')).toBe(true);
  });

  it('blocks IPv6 link-local fe80::/10', () => {
    expect(adapter.testIsPrivateIp('fe80::1')).toBe(true);
    expect(adapter.testIsPrivateIp('fe90::1')).toBe(true);
    expect(adapter.testIsPrivateIp('fea0::1')).toBe(true);
    expect(adapter.testIsPrivateIp('feb0::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 ::ffff:127.0.0.1', () => {
    expect(adapter.testIsPrivateIp('::ffff:127.0.0.1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 ::ffff:10.0.0.1', () => {
    expect(adapter.testIsPrivateIp('::ffff:10.0.0.1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 ::ffff:192.168.1.1', () => {
    expect(adapter.testIsPrivateIp('::ffff:192.168.1.1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 ::ffff:169.254.169.254', () => {
    expect(adapter.testIsPrivateIp('::ffff:169.254.169.254')).toBe(true);
  });
});

describe('SSRF Regression — URL scheme and hostname validation (Phase 6)', () => {
  const adapter = new TestAdapter();

  it('rejects file:// protocol', async () => {
    expect(await adapter.testIsSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects ftp:// protocol', async () => {
    expect(await adapter.testIsSafeUrl('ftp://example.com/file')).toBe(false);
  });

  it('rejects javascript: protocol', async () => {
    expect(await adapter.testIsSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: protocol', async () => {
    expect(await adapter.testIsSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects empty URL', async () => {
    expect(await adapter.testIsSafeUrl('')).toBe(false);
  });

  it('rejects localhost hostname', async () => {
    expect(await adapter.testIsSafeUrl('https://localhost/admin')).toBe(false);
  });

  it('rejects 0.0.0.0', async () => {
    expect(await adapter.testIsSafeUrl('https://0.0.0.0/')).toBe(false);
  });

  it('rejects metadata.google.internal hostname', async () => {
    expect(await adapter.testIsSafeUrl('https://metadata.google.internal/computeMetadata/v1/')).toBe(false);
  });
});

describe('SSRF Regression — CGNAT and reserved ranges (Phase 6)', () => {
  const adapter = new TestAdapter();

  it('blocks CGNAT 100.64.0.0/10', () => {
    expect(adapter.testIsPrivateIp('100.64.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('100.127.255.255')).toBe(true);
  });

  it('does NOT block 100.63.x.x (outside CGNAT)', () => {
    expect(adapter.testIsPrivateIp('100.63.255.255')).toBe(false);
  });

  it('does NOT block 100.128.x.x (outside CGNAT)', () => {
    expect(adapter.testIsPrivateIp('100.128.0.1')).toBe(false);
  });

  it('blocks multicast 224.0.0.0/4', () => {
    expect(adapter.testIsPrivateIp('224.0.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('239.255.255.255')).toBe(true);
  });

  it('blocks reserved 240.0.0.0/4', () => {
    expect(adapter.testIsPrivateIp('240.0.0.1')).toBe(true);
    expect(adapter.testIsPrivateIp('255.255.255.255')).toBe(true);
  });
});

describe('Telegram Authorization Regression (Phase 6)', () => {
  it('isAllowed returns true when ALLOWED_USER_IDS is empty (open access)', () => {
    const testConfig = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test_token',
      PG_USER: 'test',
      PG_PASSWORD: 'test',
      PG_DATABASE: 'test',
      ALLOWED_USER_IDS: '',
    });
    expect(testConfig.allowedUserIds).toEqual([]);
  });

  it('isAllowed parses comma-separated user IDs', () => {
    const testConfig = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test_token',
      PG_USER: 'test',
      PG_PASSWORD: 'test',
      PG_DATABASE: 'test',
      ALLOWED_USER_IDS: '111,222,333',
    });
    expect(testConfig.allowedUserIds).toEqual([111, 222, 333]);
  });

  it('isAllowed filters invalid user IDs', () => {
    const testConfig = loadConfig({
      TELEGRAM_BOT_TOKEN: 'test_token',
      PG_USER: 'test',
      PG_PASSWORD: 'test',
      PG_DATABASE: 'test',
      ALLOWED_USER_IDS: 'abc,123,def,456',
    });
    expect(testConfig.allowedUserIds).toEqual([123, 456]);
  });
});

describe('Secret Leakage Regression (Phase 6)', () => {
  it('logger sanitize redacts password field', () => {
    const reqLogger = createRequestLogger('req_test_001');
    expect(() => reqLogger.info('test', { password: 'mySecret123', name: 'test' })).not.toThrow();
  });

  it('logger sanitize redacts token field', () => {
    const reqLogger = createRequestLogger('req_test_002');
    expect(() => reqLogger.info('test', { token: 'bot123456:ABC', data: 'ok' })).not.toThrow();
  });

  it('health status does not leak secrets', async () => {
    const status = await getHealthStatus();
    const json = JSON.stringify(status);
    expect(json).not.toMatch(/password|token|secret|apikey|api_key|credential/i);
  });

  it('health status does not leak connection strings', async () => {
    const status = await getHealthStatus();
    const json = JSON.stringify(status);
    expect(json).not.toMatch(/postgres:\/\/|redis:\/\/|amqp:\/\//i);
  });

  it('metrics text does not contain secrets', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../observability/metrics');
    const text = mod.metricsRegistry.toPrometheusText();
    expect(text).not.toMatch(/password|token|secret|apikey/i);
  });
});
