/**
 * Database Connection Resolver tests
 *
 * Verifies resolution order (SUPABASE_DATABASE_URL → DATABASE_URL → PG_*),
 * URI parsing, SSL defaults, and the fail-closed behavior when no DB env
 * is configured. Uses pure function tests — no live database required.
 */
import {
  parsePgUri,
  resolveDbConfig,
  DbConfigError,
  poolDefaultsForServerless,
  poolDefaultsForWorker,
} from './connection';

const BASE_ENV = {
  TELEGRAM_BOT_TOKEN: 'test_token',
  PG_HOST: 'localhost',
  PG_PORT: '5432',
  PG_USER: 'marketintele_app',
  PG_PASSWORD: 'CHANGE_ME',
  PG_DATABASE: 'marketintele',
  PG_SSL_MODE: 'disable',
};

describe('Connection Resolver — parsePgUri', () => {
  it('parses a standard postgres URI', () => {
    const { config, host, port, sslmode } = parsePgUri('postgresql://user:pass@localhost:5432/mydb');
    expect(host).toBe('localhost');
    expect(port).toBe(5432);
    expect(config.user).toBe('user');
    expect(config.password).toBe('pass');
    expect(config.database).toBe('mydb');
    expect(sslmode).toBeNull();
  });

  it('parses sslmode query parameter', () => {
    const { sslmode, config } = parsePgUri('postgresql://u:p@host:5432/db?sslmode=require');
    expect(sslmode).toBe('require');
    expect(config.host).toBe('host');
  });

  it('throws on invalid URI', () => {
    expect(() => parsePgUri('not-a-url')).toThrow(DbConfigError);
  });

  it('throws on non-postgres protocol', () => {
    expect(() => parsePgUri('https://example.com')).toThrow(DbConfigError);
  });

  it('accepts postgres:// short scheme', () => {
    const { config } = parsePgUri('postgres://u:p@host:5432/db');
    expect(config.host).toBe('host');
  });

  it('decodes URL-encoded credentials', () => {
    const { config } = parsePgUri('postgresql://user%40x:p%40ss@host:5432/db');
    expect(config.user).toBe('user@x');
    expect(config.password).toBe('p@ss');
  });
});

describe('Connection Resolver — resolution order', () => {
  it('prefers SUPABASE_DATABASE_URL over DATABASE_URL and PG_*', () => {
    const env = {
      ...BASE_ENV,
      SUPABASE_DATABASE_URL: 'postgresql://postgres.xxxx:pass@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    };
    const r = resolveDbConfig(env);
    expect(r.source).toBe('supabase');
    expect(r.isSupabasePooler).toBe(true);
    expect(r.sslRequired).toBe(true);
    expect(r.label).toContain('supabase.com:6543');
  });

  it('falls back to DATABASE_URL when SUPABASE_DATABASE_URL unset', () => {
    const env = {
      ...BASE_ENV,
      DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app',
    };
    const r = resolveDbConfig(env);
    expect(r.source).toBe('database_url');
    expect(r.isSupabasePooler).toBe(false);
    expect(r.sslRequired).toBe(true); // non-localhost defaults to SSL
  });

  it('falls back to PG_* discrete vars when no URI set', () => {
    const r = resolveDbConfig(BASE_ENV);
    expect(r.source).toBe('pg_vars');
    expect(r.config.host).toBe('localhost');
    expect(r.config.port).toBe(5432);
    expect(r.sslRequired).toBe(false); // PG_SSL_MODE=disable
  });

  it('throws DbConfigError when no DB env is configured at all', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'test',
      // No PG_* and no URI
    };
    expect(() => resolveDbConfig(env)).toThrow(DbConfigError);
  });

  it('enables SSL by default for non-localhost hosts (DATABASE_URL)', () => {
    const r = resolveDbConfig({
      ...BASE_ENV,
      DATABASE_URL: 'postgresql://u:p@remote.example.com:5432/db',
    });
    expect(r.sslRequired).toBe(true);
    expect(r.config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('disables SSL for localhost (DATABASE_URL)', () => {
    const r = resolveDbConfig({
      ...BASE_ENV,
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    });
    expect(r.sslRequired).toBe(false);
    expect(r.config.ssl).toBe(false);
  });

  it('honors PG_SSL_MODE=verify-full', () => {
    const r = resolveDbConfig({ ...BASE_ENV, PG_SSL_MODE: 'verify-full' });
    expect(r.config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('honors PG_SSL_MODE=require', () => {
    const r = resolveDbConfig({ ...BASE_ENV, PG_SSL_MODE: 'require' });
    expect(r.config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('detects Supabase pooler by port 6543', () => {
    const r = resolveDbConfig({
      ...BASE_ENV,
      SUPABASE_DATABASE_URL: 'postgresql://u:p@aws-0-region.pooler.supabase.com:6543/postgres',
    });
    expect(r.isSupabasePooler).toBe(true);
  });

  it('detects direct Supabase connection by port 5432 (not pooler)', () => {
    const r = resolveDbConfig({
      ...BASE_ENV,
      SUPABASE_DATABASE_URL: 'postgresql://u:p@aws-0-region.pooler.supabase.com:5432/postgres',
    });
    expect(r.isSupabasePooler).toBe(false);
  });
});

describe('Connection Resolver — pool defaults', () => {
  it('serverless pool has small max and short idle timeout', () => {
    const d = poolDefaultsForServerless();
    expect(d.max).toBe(3);
    expect(d.idleTimeoutMillis).toBeLessThanOrEqual(10000);
  });

  it('worker pool has larger max and longer idle timeout', () => {
    const d = poolDefaultsForWorker();
    expect(d.max).toBe(10);
    expect(d.idleTimeoutMillis).toBeGreaterThanOrEqual(30000);
  });
});
