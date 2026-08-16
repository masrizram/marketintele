#!/usr/bin/env tsx
/**
 * MarketIntele — Database Migration Runner
 *
 * Applies the full set of SQL migrations to PostgreSQL in order.
 * Each migration lives in src/arbitrage/db/migrations/<sequence>-<name>.sql
 * and is tracked in the `schema_migrations` table.
 *
 * Connection resolution (Supabase-aware):
 *   1. SUPABASE_DATABASE_URL  (preferred)
 *   2. DATABASE_URL
 *   3. PG_* discrete vars
 * The migration runner uses a direct (non-pooled) connection when possible,
 * because DDL over PgBouncer transaction mode (port 6543) can be unreliable.
 *
 * Usage:
 *   npx tsx src/arbitrage/db/migrate.ts
 */

import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { resolveDbConfig, createPool, ResolvedDbConfig } from './connection';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

/**
 * Resolve the DB config for migrations. When the resolved connection is a
 * Supabase pooler (port 6543), warn: DDL is best run over the direct
 * connection (port 5432).
 */
function getDbConfig(): ResolvedDbConfig {
  const resolved = resolveDbConfig();
  if (resolved.isSupabasePooler) {
    logger.warn(
      `Migrations are running against a Supabase pooler (${resolved.label}). ` +
      'For DDL reliability, prefer the direct connection (port 5432) for migrations when available.',
    );
  }
  return resolved;
}

async function runMigrations(): Promise<void> {
  logger.info('Starting database migrations...');

  const resolved = getDbConfig();
  const pool = createPool(resolved, { serverless: false, poolMax: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Ensure schema_migrations table exists ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          SERIAL PRIMARY KEY,
        version     VARCHAR(255) NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum    VARCHAR(64)
      );
    `);

    // ── List & sort migration files ─────────────────────────────────────────
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      logger.warn('No migration files found in', MIGRATIONS_DIR);
      return;
    }

    // ── Check which migrations have already been applied ────────────────────
    const appliedRows = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const appliedVersions = new Set(appliedRows.rows.map((r) => r.version));

    for (const file of files) {
      const version = file.replace(/\.sql$/i, '');
      if (appliedVersions.has(version)) {
        logger.info(`Skipping already-applied migration: ${file}`);
        continue;
      }

      logger.info(`Applying migration: ${file}`);

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await client.query(sql);

      // Compute checksum of the raw SQL file for audit
      const { createHash } = await import('crypto');
      const checksum = createHash('sha256').update(sql).digest('hex');

      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [version, file, checksum],
      );

      logger.info(`✓ Migration ${file} applied successfully`);
    }

    await client.query('COMMIT');
    logger.info(`All migrations applied successfully (${files.length} total, ${files.length - appliedVersions.size} new)`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ msg: 'Migration failed — rolled back', error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────
runMigrations()
  .then(() => {
    logger.info('Migration runner finished.');
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ msg: 'Fatal migration error', error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
    process.exit(1);
  });
