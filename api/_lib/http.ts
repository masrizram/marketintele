/**
 * Shared helpers for Vercel API routes.
 *
 * These helpers wrap Vercel's (req, res) Node handler convention with:
 * - JSON response helpers
 * - admin API key guard (constant-time compare)
 * - serverless-safe DB pool lifecycle
 *
 * Vercel's Node serverless functions pass objects shaped like Node's
 * `http.IncomingMessage` and `http.ServerResponse`. We type against those
 * built-ins (augmented with a `query` field) so the project does NOT need the
 * `@vercel/node` package at typecheck time. At runtime on Vercel, the real
 * Vercel request/response objects are structurally compatible.
 *
 * This module is import-safe in serverless: it does NOT import telegraf,
 * better-sqlite3, or the legacy SQLite layer.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { Pool } from 'pg';
import { resolveDbConfig, createPool, ResolvedDbConfig } from '../../src/arbitrage/db/connection';
import { healthCheck as pgHealthCheck } from '../../src/arbitrage/db/pool';
import { adapterRegistry, registerDefaults } from '../../src/arbitrage/adapters/registry';
import { getHealthStatus, getLivenessStatus, getReadinessStatus } from '../../src/arbitrage/observability/health';
import { metricsRegistry } from '../../src/arbitrage/observability/metrics';

export interface VercelRequest extends IncomingMessage {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export type VercelResponse = ServerResponse;
export type ApiHandler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

const APP_VERSION = '2.0.0';

export function json(res: VercelResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function text(res: VercelResponse, status: number, body: string, contentType = 'text/plain'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}

/**
 * Constant-time string compare to resist timing attacks on the admin key.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to keep timing roughly uniform.
    let acc = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      acc |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false && acc === 0;
  }
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

/**
 * Require a valid admin API key in the `x-admin-api-key` header.
 * Returns true if authorized, false otherwise (and writes a 401 response).
 */
export function requireAdmin(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.trim().length === 0) {
    json(res, 503, { error: 'Admin API not configured (ADMIN_API_KEY missing)' });
    return false;
  }
  const provided = req.headers['x-admin-api-key'];
  const providedStr = Array.isArray(provided) ? provided[0] || '' : provided || '';
  if (!timingSafeEqual(String(providedStr), expected)) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * Create a short-lived serverless pool and run `fn` against it, closing the
 * pool in a finally block to avoid connection leaks across invocations.
 */
export async function withServerlessDb<T>(fn: (pool: Pool, resolved: ResolvedDbConfig) => Promise<T>): Promise<T> {
  const resolved = resolveDbConfig();
  const pool = createPool(resolved, { serverless: true });
  try {
    return await fn(pool, resolved);
  } finally {
    try { await pool.end(); } catch { /* ignore */ }
  }
}

export {
  pgHealthCheck,
  adapterRegistry,
  registerDefaults,
  getHealthStatus,
  getLivenessStatus,
  getReadinessStatus,
  metricsRegistry,
  APP_VERSION,
};
