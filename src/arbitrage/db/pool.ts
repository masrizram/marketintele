import { Pool } from 'pg';
import { ulid } from 'ulid';
import { sha256 } from '../lib/hash';
import { logger } from '../lib/logger';
import {
  resolveDbConfig,
  createPool,
  ResolvedDbConfig,
} from './connection';

/**
 * Database connection pool — single shared pool for the arbitrage engine.
 *
 * Connection resolution is centralized in ./connection.ts so the same engine
 * can run against Supabase (SUPABASE_DATABASE_URL), a generic DATABASE_URL, or
 * local PG_* discrete vars. The pool is lazily initialized on first use and
 * closed on process exit.
 *
 * In serverless (Vercel) contexts, use createServerlessPool() instead of the
 * shared getPool() to avoid exhausting connections across invocations.
 */
let pool: Pool | null = null;
let resolved: ResolvedDbConfig | null = null;

export function getPool(): Pool {
  if (!pool) {
    resolved = resolveDbConfig();
    pool = createPool(resolved, { serverless: false });
    pool.on('error', (err) => {
      logger.error('Unexpected PostgreSQL pool error:', err);
    });
    logger.info(`PostgreSQL pool created: ${resolved.label}`);
  }
  return pool;
}

/**
 * Create a short-lived pool suitable for a single serverless invocation.
 * The caller is responsible for calling pool.end() in a finally block.
 */
export function createServerlessPool(): { pool: Pool; resolved: ResolvedDbConfig } {
  const r = resolveDbConfig();
  const p = createPool(r, { serverless: true });
  p.on('error', (err) => {
    logger.error('Unexpected serverless PostgreSQL pool error:', err);
  });
  return { pool: p, resolved: r };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    resolved = null;
    logger.info('PostgreSQL pool closed.');
  }
}

/**
 * Execute a query with named parameters, returning parsed rows.
 */
export async function query<T>(sql: string, params?: any[]): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

/**
 * Execute a raw query without parsing.
 */
export async function rawQuery(sql: string, params?: any[]): Promise<void> {
  await getPool().query(sql, params);
}

/**
 * Transaction wrapper — executes `fn` inside a transaction, committing on
 * success and rolling back on error.
 */
export async function withTransaction<T>(
  fn: (client: any) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Generate a ULID and return it as a string.
 */
export function newId(): string {
  return ulid();
}

/**
 * Compute a SHA-256 checksum of a string.
 */
export function checksum(data: string): string {
  return sha256(data);
}

/**
 * Execute a health check query to verify the database is reachable.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await getPool().query('SELECT 1 AS alive');
    return result.rows.length > 0 && result.rows[0].alive === 1;
  } catch {
    return false;
  }
}
