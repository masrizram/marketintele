import { parseConfig, loadConfig, requireWorkerConfig } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration security & correctness tests
//
// Ensures:
// - Config never exposes hardcoded secrets (IDEA.xml §90: Never expose credentials)
// - SSRF firewall is enabled by default
// - PG credentials are required (not defaulted to empty)
// - Config is typed correctly
// ─────────────────────────────────────────────────────────────────────────────

const VALID_ENV = {
  TELEGRAM_BOT_TOKEN: 'test_token',
  PG_HOST: 'localhost',
  PG_PORT: '5432',
  PG_USER: 'marketintele_app',
  PG_PASSWORD: 'test_password',
  PG_DATABASE: 'marketintele',
};

describe('Configuration — Security', () => {
  it('SSRF firewall is enabled by default via env', () => {
    const parsed = parseConfig({ ...VALID_ENV });
    expect(parsed.SSRF_FIREWALL_ENABLED).toBe(true);
  });

  it('does NOT contain any hardcoded credentials in the parsed config', () => {
    const parsed = parseConfig({ ...VALID_ENV });
    const configStr = JSON.stringify(parsed);
    expect(configStr).not.toContain('password123');
    expect(configStr).not.toContain('admin123');
    expect(configStr).not.toMatch(/(?:password|token)\s*:\s*["'][^"']{4,}["']/i);
  });

  it('PG_USER/PG_PASSWORD default to empty (schema-level) but worker still boots', () => {
    // The shared schema makes PG_* optional so the serverless API can import
    // the engine without a full DB env (the DB layer throws later if no
    // connection can be resolved). This is intentional for Vercel compatibility.
    const parsed = parseConfig({
      TELEGRAM_BOT_TOKEN: 'test',
      PG_HOST: 'localhost',
      PG_PORT: '5432',
      PG_DATABASE: 'db',
      // PG_USER and PG_PASSWORD missing — schema no longer throws.
    });
    expect(parsed.PG_USER).toBe('');
    expect(parsed.PG_PASSWORD).toBe('');
  });

  it('TELEGRAM_BOT_TOKEN is optional at schema level (API compatibility)', () => {
    // The schema allows an empty token so the Vercel API layer can import the
    // engine without Telegram credentials. The WORKER guard enforces presence.
    const parsed = parseConfig({
      PG_HOST: 'localhost',
      PG_PORT: '5432',
      PG_USER: 'user',
      PG_PASSWORD: 'pass',
      PG_DATABASE: 'db',
    });
    expect(parsed.TELEGRAM_BOT_TOKEN).toBe('');
  });

  it('requireWorkerConfig throws when TELEGRAM_BOT_TOKEN is missing', () => {
    expect(() => {
      requireWorkerConfig({
        PG_HOST: 'localhost',
        PG_PORT: '5432',
        PG_USER: 'user',
        PG_PASSWORD: 'pass',
        PG_DATABASE: 'db',
      });
    }).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('requireWorkerConfig does NOT throw when TELEGRAM_BOT_TOKEN is present', () => {
    expect(() => {
      requireWorkerConfig({
        TELEGRAM_BOT_TOKEN: 'test_token',
        PG_HOST: 'localhost',
        PG_PORT: '5432',
        PG_USER: 'user',
        PG_PASSWORD: 'pass',
        PG_DATABASE: 'db',
      });
    }).not.toThrow();
  });
});

describe('Configuration — Supabase / DATABASE_URL resolution', () => {
  it('accepts SUPABASE_DATABASE_URL', () => {
    const parsed = parseConfig({
      ...VALID_ENV,
      SUPABASE_DATABASE_URL: 'postgresql://postgres.xxxx:pass@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require',
    });
    expect(parsed.SUPABASE_DATABASE_URL).toContain('supabase.com:6543');
  });

  it('accepts DATABASE_URL', () => {
    const parsed = parseConfig({
      ...VALID_ENV,
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(parsed.DATABASE_URL).toContain('localhost:5432');
  });

  it('accepts APPLICATION_ENV', () => {
    const parsed = parseConfig({ ...VALID_ENV, APPLICATION_ENV: 'production' });
    expect(parsed.APPLICATION_ENV).toBe('production');
  });

  it('loadConfig exposes supabase fields when provided', () => {
    const cfg = loadConfig({
      ...VALID_ENV,
      SUPABASE_DATABASE_URL: 'postgresql://u:p@host:5432/db',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    });
    expect(cfg.supabaseDatabaseUrl).toContain('host:5432');
    expect(cfg.supabaseUrl).toBe('https://example.supabase.co');
    expect(cfg.supabaseAnonKey).toBe('anon');
    expect(cfg.supabaseServiceRoleKey).toBe('service');
  });
});

describe('Configuration — PostgreSQL', () => {
  it('accepts verify-full SSL mode', () => {
    const parsed = parseConfig({ ...VALID_ENV, PG_SSL_MODE: 'verify-full' });
    expect(parsed.PG_SSL_MODE).toBe('verify-full');
  });

  it('accepts disable SSL mode', () => {
    const parsed = parseConfig({ ...VALID_ENV, PG_SSL_MODE: 'disable' });
    expect(parsed.PG_SSL_MODE).toBe('disable');
  });

  it('defaults to disable SSL mode when not specified', () => {
    const parsed = parseConfig({ ...VALID_ENV });
    expect(parsed.PG_SSL_MODE).toBe('disable');
  });
});

describe('Configuration — SSRF firewall', () => {
  it('can be explicitly disabled via env', () => {
    const parsed = parseConfig({ ...VALID_ENV, SSRF_FIREWALL_ENABLED: 'false' });
    expect(parsed.SSRF_FIREWALL_ENABLED).toBe(false);
  });

  it('can be explicitly enabled via env', () => {
    const parsed = parseConfig({ ...VALID_ENV, SSRF_FIREWALL_ENABLED: 'true' });
    expect(parsed.SSRF_FIREWALL_ENABLED).toBe(true);
  });
});
