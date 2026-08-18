/**
 * Database Connection Resolver
 *
 * Centralizes how a PostgreSQL connection is selected so the same engine can
 * run against Supabase (cloud), a generic URI, or local discrete PG_* vars.
 *
 * Resolution order (first non-empty wins):
 *   1. SUPABASE_DATABASE_URL  — preferred for production / serverless
 *   2. DATABASE_URL           — generic PostgreSQL URI
 *   3. PG_* discrete vars      — local Docker/PostgreSQL fallback
 *   4. throw DbConfigError     — never silently default credentials
 *
 * This module is import-safe in the worker (Fly.io) context: it does NOT
 * import telegraf, better-sqlite3, or the legacy SQLite layer.
 */
import { Pool, PoolConfig } from 'pg';
import { getConfig } from '../../config';

export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbConfigError';
  }
}

export type DbSource = 'supabase' | 'database_url' | 'pg_vars' | 'none';

export interface ResolvedDbConfig {
  source: DbSource;
  /** A node-postgres PoolConfig ready for `new Pool(...)`. */
  config: PoolConfig;
  /** Human-readable label for logs (never includes the password). */
  label: string;
  /** True when the host looks like a Supabase pooler (port 6543). */
  isSupabasePooler: boolean;
  /** True when the host is non-localhost and SSL is enabled/required. */
  sslRequired: boolean;
}

/**
 * Parse a PostgreSQL URI into a node-postgres PoolConfig, preserving any
 * `sslmode` query parameter. Throws on malformed URIs.
 */
export function parsePgUri(uri: string): { config: PoolConfig; host: string; port: number; sslmode: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new DbConfigError(`Invalid database URI (parse failed)`);
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new DbConfigError(`Unsupported database URI protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname || 'localhost';
  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  const user = decodeURIComponent(parsed.username || '');
  const password = decodeURIComponent(parsed.password || '');
  const database = parsed.pathname.replace(/^\//, '') || '';
  const sslmode = parsed.searchParams.get('sslmode') || parsed.searchParams.get('ssl') || null;

  const config: PoolConfig = {
    host,
    port,
    user: user || undefined,
    password: password || undefined,
    database: database || undefined,
  };
  return { config, host, port, sslmode };
}

function isLocalhostHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

function sslConfigFromMode(mode: 'disable' | 'require' | 'verify-full' | string | null, host: string): false | { rejectUnauthorized: boolean } {
  if (mode === 'disable') return false;
  if (mode === 'verify-full') return { rejectUnauthorized: true };
  if (mode === 'require') return { rejectUnauthorized: false };
  // No explicit mode: default to require for any non-localhost host (safe).
  return isLocalhostHost(host) ? false : { rejectUnauthorized: false };
}

/**
 * Resolve the database connection from the environment. Throws DbConfigError
 * when no connection can be determined — the app never silently invents
 * credentials.
 *
 * @param env optional env override (tests). Defaults to process.env via config.
 */
export function resolveDbConfig(env?: Record<string, string | undefined>): ResolvedDbConfig {
  const cfg = getConfig();
  // When an explicit env is passed (tests), ONLY use that env + the parsed
  // config. Do NOT fall back to process.env, so tests can assert fail-closed
  // behavior when no DB env is provided.
  const useEnv = env !== undefined;
  const supabaseUrl = useEnv ? env!.SUPABASE_DATABASE_URL : (cfg.supabaseDatabaseUrl ?? process.env.SUPABASE_DATABASE_URL);
  const databaseUrl = useEnv ? env!.DATABASE_URL : (cfg.databaseUrl ?? process.env.DATABASE_URL);

  if (supabaseUrl && supabaseUrl.trim().length > 0) {
    const { config, host, port, sslmode } = parsePgUri(supabaseUrl);
    // A Supabase pooler is identified by port 6543 (PgBouncer transaction mode).
    // The direct connection uses port 5432.
    const isPooler = port === 6543;
    const ssl = sslConfigFromMode(sslmode, host);
    config.ssl = ssl;
    return {
      source: 'supabase',
      config,
      label: `supabase:${host}:${port}`,
      isSupabasePooler: isPooler,
      sslRequired: ssl !== false,
    };
  }

  if (databaseUrl && databaseUrl.trim().length > 0) {
    const { config, host, port, sslmode } = parsePgUri(databaseUrl);
    const ssl = sslConfigFromMode(sslmode, host);
    config.ssl = ssl;
    return {
      source: 'database_url',
      config,
      label: `database_url:${host}:${port}`,
      isSupabasePooler: false,
      sslRequired: ssl !== false,
    };
  }

  // PG_* discrete vars (local fallback)
  const pgHost = useEnv ? (env!.PG_HOST ?? '') : (cfg.pgHost ?? process.env.PG_HOST ?? 'localhost');
  const pgPort = parseInt(String(useEnv ? (env!.PG_PORT ?? '') : (cfg.pgPort ?? process.env.PG_PORT ?? '5432')), 10);
  const pgUser = useEnv ? (env!.PG_USER ?? '') : (cfg.pgUser ?? process.env.PG_USER ?? '');
  const pgPassword = useEnv ? (env!.PG_PASSWORD ?? '') : (cfg.pgPassword ?? process.env.PG_PASSWORD ?? '');
  const pgDatabase = useEnv ? (env!.PG_DATABASE ?? '') : (cfg.pgDatabase ?? process.env.PG_DATABASE ?? '');
  const pgSslMode = (useEnv ? (env!.PG_SSL_MODE ?? 'disable') : (cfg.pgSslMode ?? process.env.PG_SSL_MODE ?? 'disable')) as 'disable' | 'require' | 'verify-full';

  const hasAnyPgVar = Boolean(pgUser || pgPassword || pgDatabase || (useEnv ? env!.PG_HOST : process.env.PG_HOST));
  if (!hasAnyPgVar) {
    throw new DbConfigError(
      'No database configuration found. Set SUPABASE_DATABASE_URL (preferred), DATABASE_URL, or PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE.',
    );
  }

  const ssl = sslConfigFromMode(pgSslMode, pgHost);
  return {
    source: 'pg_vars',
    config: {
      host: pgHost,
      port: pgPort,
      user: pgUser || undefined,
      password: pgPassword || undefined,
      database: pgDatabase || undefined,
      ssl,
    },
    label: `pg_vars:${pgHost}:${pgPort}`,
    isSupabasePooler: false,
    sslRequired: ssl !== false,
  };
}

/**
 * Default pool sizing per deployment target.
 * - Worker (Fly.io, long-running): larger pool, long idle timeout.
 * - Serverless fallback: small pool, short idle timeout (for local dev/testing).
 */
export function poolDefaultsForServerless(): Partial<PoolConfig> {
  return {
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  };
}

export function poolDefaultsForWorker(): Partial<PoolConfig> {
  return {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  };
}

/**
 * Create a Pool from the resolved config, applying pool-size defaults for the
 * target runtime and honoring an explicit PG_POOL_MAX override.
 */
export function createPool(
  resolved: ResolvedDbConfig,
  options: { serverless?: boolean; poolMax?: number } = {},
): Pool {
  const defaults = options.serverless ? poolDefaultsForServerless() : poolDefaultsForWorker();
  const explicitMax = options.poolMax ?? getConfig().pgPoolMax;
  const config: PoolConfig = {
    ...defaults,
    ...resolved.config,
    ...(explicitMax ? { max: explicitMax } : {}),
  };
  return new Pool(config);
}
