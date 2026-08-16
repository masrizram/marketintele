/**
 * Central configuration for the arbitrage engine.
 *
 * Environment variables are the single source of truth — nothing is hardcoded.
 * Zod validates at import time; missing required values throw immediately.
 */
import { z } from 'zod';

// ─── Strict environment schema ────────────────────────────────────────────────
// No hardcoded credentials or fees. All values injected via env at runtime.
// Missing required values throw ZodError at startup — never silently default.

export const envSchema = z.object({
  // ── Application environment ─────────────────────────────────────────────────
  APPLICATION_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // ── Telegram ────────────────────────────────────────────────────────────────
  // Optional at the schema level so the shared engine can be imported in
  // serverless/API contexts that never use Telegram. The worker entrypoint
  // (src/index.ts) enforces presence explicitly via requireWorkerConfig().
  TELEGRAM_BOT_TOKEN: z.string().default(''),

  // ── Worker mode ─────────────────────────────────────────────────────────────
  // When true, the worker entrypoint starts the Telegram bot + health server.
  // The serverless API never sets this.
  WORKER_MODE: z
    .string()
    .transform((s) => s === 'true')
    .default('false'),

  // ── Database (Supabase — preferred for production/serverless) ───────────────
  // Full PostgreSQL URI. For Supabase, prefer the pooled connection (port 6543)
  // for serverless and the direct connection (port 5432) for the worker/migrations.
  SUPABASE_DATABASE_URL: z.string().optional(),
  // Supabase project URL + keys (documented; the JS client is not used today).
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // ── Database (generic URI — alternative to PG_* discrete vars) ─────────────
  DATABASE_URL: z.string().optional(),

  // ── Database (discrete vars — local Docker/PostgreSQL fallback) ────────────
  PG_HOST: z.string().default('localhost'),
  PG_PORT: z.coerce.number().int().positive().default(5432),
  PG_USER: z.string().default(''),
  PG_PASSWORD: z.string().default(''),
  PG_DATABASE: z.string().default(''),
  PG_SSL_MODE: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  // Max server-side connections per pool. Serverless should be small (e.g. 3);
  // the worker can be larger (e.g. 10). 0 = use node-postgres default.
  PG_POOL_MAX: z.coerce.number().int().positive().optional(),

  // Legacy SQLite path (kept for existing belibot promobackend during transition).
  DATABASE_PATH: z.string().default('./data/belibot.db'),

  // ── Redis ───────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url().default('redis://localhost:6379/0'),

  // ── Scraper behaviour (no secrets — tuning knobs only) ─────────────────────
  SCRAPER_REQUEST_TIMEOUT_MS: z
    .coerce.number()
    .int()
    .positive()
    .default(15000),
  SCRAPER_DELAY_MIN_MS: z.coerce.number().int().positive().default(1000),
  SCRAPER_DELAY_MAX_MS: z.coerce.number().int().positive().default(3000),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().positive().default(5),

  // ── Operational ─────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MAX_SEARCH_RESULTS: z.coerce.number().int().positive().default(10),
  NOTIFICATION_CHECK_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
  ALLOWED_USER_IDS: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id)),
    )
    .default(''),
  // When true, the SSRF firewall drops requests to private/reserved IP ranges.
  SSRF_FIREWALL_ENABLED: z
    .string()
    .transform((s) => s === 'true')
    .default('true'),
});

/**
 * Validate and parse an environment object into a config.
 * Exported so tests can validate partial envs without needing real env vars.
 */
export function parseConfig(env: Record<string, string | undefined>) {
  return envSchema.parse(env);
}

// ─── Config interface ──────────────────────────────────────────────────────────
export interface Config {
  applicationEnv: 'development' | 'test' | 'production';
  telegramBotToken: string;
  workerMode: boolean;
  allowedUserIds: number[];
  supabaseDatabaseUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;
  pgSslMode: 'disable' | 'require' | 'verify-full';
  pgPoolMax?: number;
  databasePath: string;
  redisUrl: string;
  scraperRequestTimeout: number;
  scraperDelayMin: number;
  scraperDelayMax: number;
  maxConcurrentRequests: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  maxSearchResults: number;
  notificationCheckInterval: number;
  ssrfFirewallEnabled: boolean;
}

/**
 * Lazily-load and cache the config.  In production this runs once at first
 * access; in tests you can call `loadConfig()` with a custom env to override.
 */
let _config: Config | null = null;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.parse(env);
  _config = {
    applicationEnv: parsed.APPLICATION_ENV,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    workerMode: parsed.WORKER_MODE,
    allowedUserIds: parsed.ALLOWED_USER_IDS,
    supabaseDatabaseUrl: parsed.SUPABASE_DATABASE_URL,
    supabaseUrl: parsed.SUPABASE_URL,
    supabaseAnonKey: parsed.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: parsed.DATABASE_URL,
    pgHost: parsed.PG_HOST,
    pgPort: parsed.PG_PORT,
    pgUser: parsed.PG_USER,
    pgPassword: parsed.PG_PASSWORD,
    pgDatabase: parsed.PG_DATABASE,
    pgSslMode: parsed.PG_SSL_MODE,
    pgPoolMax: parsed.PG_POOL_MAX,
    databasePath: parsed.DATABASE_PATH,
    redisUrl: parsed.REDIS_URL,
    scraperRequestTimeout: parsed.SCRAPER_REQUEST_TIMEOUT_MS,
    scraperDelayMin: parsed.SCRAPER_DELAY_MIN_MS,
    scraperDelayMax: parsed.SCRAPER_DELAY_MAX_MS,
    maxConcurrentRequests: parsed.MAX_CONCURRENT_REQUESTS,
    logLevel: parsed.LOG_LEVEL,
    maxSearchResults: parsed.MAX_SEARCH_RESULTS,
    notificationCheckInterval: parsed.NOTIFICATION_CHECK_INTERVAL_SEC,
    ssrfFirewallEnabled: parsed.SSRF_FIREWALL_ENABLED,
  };
  return _config!;
}

/**
 * Get the cached config. Throws if not initialized.
 */
export function getConfig(): Config {
  if (!_config) {
    return loadConfig();
  }
  return _config!;
}

// Eagerly load in non-test environments.
// Tests must use loadConfig() explicitly to control env vars.
if (typeof process.env.JEST_WORKER_ID === 'undefined' && process.env.NODE_ENV !== 'test') {
  loadConfig();
}

// ─── Default export: getConfig() ─────────────────────────────────────────────
// Code that imports { config } gets a getter that lazily resolves.
// In production this is loaded once. In tests, call loadConfig() first.
const _configExport = new Proxy({} as Config, {
  get(_target, prop) {
    return Reflect.get(getConfig(), prop);
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(getConfig(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getConfig());
  },
  has(_target, prop) {
    return Reflect.has(getConfig(), prop);
  },
});

export const config = _configExport;

// ─── Convenience re-export: dbConfig ─────────────────────────────────────────
// NOTE: dbConfig reflects only the discrete PG_* variables. The production
// connection resolver (src/arbitrage/db/connection.ts) should be used to pick
// the actual connection (SUPABASE_DATABASE_URL → DATABASE_URL → PG_*).
// dbConfig is retained for backwards compatibility with existing imports.
export const dbConfig = {
  get host(): string { return getConfig().pgHost; },
  get port(): number { return getConfig().pgPort; },
  get user(): string { return getConfig().pgUser; },
  get password(): string { return getConfig().pgPassword; },
  get database(): string { return getConfig().pgDatabase; },
  get ssl(): false | { rejectUnauthorized: boolean } {
    const mode = getConfig().pgSslMode;
    return mode === 'disable' ? false : { rejectUnauthorized: mode === 'verify-full' };
  },
};

/**
 * Worker guard — validates that the environment has everything the worker
 * entrypoint (Telegram bot + health server + legacy SQLite) needs to boot.
 *
 * The shared Zod schema makes TELEGRAM_BOT_TOKEN optional so the serverless
 * API can import the engine without a token. The worker MUST call this before
 * starting the bot; it throws (and the worker exits 1) if required worker
 * secrets are missing.
 */
export function requireWorkerConfig(env: Record<string, string | undefined> = process.env): void {
  const cfg = loadConfig(env);
  if (!cfg.telegramBotToken || cfg.telegramBotToken.trim().length === 0) {
    throw new Error('TELEGRAM_BOT_TOKEN is required for the worker entrypoint. The API layer may omit it.');
  }
}

export default config;
