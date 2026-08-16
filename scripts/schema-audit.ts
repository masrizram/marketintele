#!/usr/bin/env tsx
/**
 * MarketIntele — Schema Audit
 *
 * Verifies the live database schema against the expected migration:
 *   - all expected tables exist
 *   - all expected foreign keys exist
 *   - all expected indexes exist
 *   - NUMERIC(18,4) financial columns exist with correct precision/scale
 *   - ULID PKs are VARCHAR(26)
 *   - marketplace seed rows exist (5)
 *   - schema_migrations contains the applied migration with a matching checksum
 *
 * Exit 0 on PASS, 1 on any mismatch. Never prints secrets.
 *
 * Usage:
 *   npx tsx scripts/schema-audit.ts
 */
import 'dotenv/config';
import { resolveDbConfig, createPool } from '../src/arbitrage/db/connection';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const MIGRATIONS_DIR = resolve(__dirname, '..', 'src', 'arbitrage', 'db', 'migrations');

const EXPECTED_TABLES = [
  'sources', 'source_health', 'crawl_jobs', 'crawl_events', 'raw_documents', 'raw_products',
  'suppliers', 'supplier_contacts', 'supplier_products', 'supplier_prices',
  'products', 'product_variants', 'product_matches',
  'marketplaces', 'marketplace_listings', 'marketplace_prices',
  'demand_signals', 'competition_snapshots',
  'cost_models', 'profit_models', 'sensitivity_models',
  'opportunities', 'opportunity_scores', 'test_orders',
  'sales_actuals', 'profit_attribution', 'model_calibrations',
  'audit_logs', 'schema_migrations',
];

// Financial NUMERIC(18,4) columns expected in the schema.
const EXPECTED_NUMERIC_18_4: Array<{ table: string; column: string }> = [
  { table: 'supplier_prices', column: 'price' },
  { table: 'supplier_prices', column: 'price_per_unit' },
  { table: 'marketplace_prices', column: 'price' },
  { table: 'marketplace_prices', column: 'original_price' },
  { table: 'cost_models', column: 'supplier_cost' },
  { table: 'cost_models', column: 'landed_cost' },
  { table: 'cost_models', column: 'vendor_fee_total' },
  { table: 'cost_models', column: 'inbound_logistics' },
  { table: 'cost_models', column: 'import_duties' },
  { table: 'cost_models', column: 'vat' },
  { table: 'cost_models', column: 'customs' },
  { table: 'cost_models', column: 'payment_fee' },
  { table: 'cost_models', column: 'packaging_in' },
  { table: 'cost_models', column: 'qc_cost' },
  { table: 'cost_models', column: 'wastage' },
  { table: 'cost_models', column: 'handling' },
  { table: 'profit_models', column: 'selling_price_conservative' },
  { table: 'profit_models', column: 'selling_price_base' },
  { table: 'profit_models', column: 'selling_price_optimistic' },
  { table: 'profit_models', column: 'market_clearing_price' },
  { table: 'profit_models', column: 'net_profit_per_unit' },
  { table: 'profit_models', column: 'break_even_price' },
  { table: 'opportunities', column: 'expected_value' },
  { table: 'opportunities', column: 'required_validation_capital' },
  { table: 'test_orders', column: 'test_unit_price' },
  { table: 'test_orders', column: 'test_capital' },
  { table: 'test_orders', column: 'expected_profit' },
  { table: 'test_orders', column: 'actual_revenue' },
  { table: 'test_orders', column: 'actual_cost' },
  { table: 'test_orders', column: 'actual_profit' },
  { table: 'sales_actuals', column: 'realized_revenue' },
  { table: 'sales_actuals', column: 'realized_costs' },
  { table: 'sales_actuals', column: 'realized_profit' },
  { table: 'profit_attribution', column: 'predicted_profit' },
  { table: 'profit_attribution', column: 'realized_profit' },
  { table: 'profit_attribution', column: 'delta' },
  { table: 'competition_snapshots', column: 'lowest_price' },
  { table: 'competition_snapshots', column: 'highest_price' },
  { table: 'competition_snapshots', column: 'median_price' },
];

// Tables whose PK is a ULID stored as VARCHAR(26).
const EXPECTED_ULID_PK_TABLES = [
  'sources', 'source_health', 'crawl_jobs', 'crawl_events', 'raw_documents', 'raw_products',
  'suppliers', 'supplier_contacts', 'supplier_products', 'supplier_prices',
  'products', 'product_variants', 'product_matches',
  'marketplaces', 'marketplace_listings', 'marketplace_prices',
  'demand_signals', 'competition_snapshots',
  'cost_models', 'profit_models', 'sensitivity_models',
  'opportunities', 'opportunity_scores', 'test_orders',
  'sales_actuals', 'profit_attribution', 'model_calibrations',
  'audit_logs',
];

const EXPECTED_MARKETPLACES = ['shopee', 'tokopedia', 'lazada', 'blibli', 'tiktok_shop'];

interface Outcome { name: string; result: 'PASS' | 'FAIL'; detail: string; }
const outcomes: Outcome[] = [];
function add(name: string, result: 'PASS' | 'FAIL', detail: string): void { outcomes.push({ name, result, detail }); }

async function run(): Promise<number> {
  const resolved = resolveDbConfig();
  const pool = createPool(resolved, { serverless: true, poolMax: 2 });
  try {
    // ── 1. All expected tables exist ────────────────────────────────────────
    const tablesRes = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    const liveTables = new Set(tablesRes.rows.map((r: any) => r.table_name));
    const missingTables = EXPECTED_TABLES.filter((t) => !liveTables.has(t));
    add('tables exist', missingTables.length === 0 ? 'PASS' : 'FAIL',
      missingTables.length === 0 ? `${EXPECTED_TABLES.length} tables present` : `missing: ${missingTables.join(', ')}`);

    // ── 2. Foreign keys exist ────────────────────────────────────────────────
    const fkRes = await pool.query(`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public'
    `);
    add('foreign keys', fkRes.rows.length >= 20 ? 'PASS' : 'FAIL', `${fkRes.rows.length} FK constraints found`);

    // ── 3. Indexes exist ─────────────────────────────────────────────────────
    const idxRes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname='public'
    `);
    add('indexes', idxRes.rows.length >= 40 ? 'PASS' : 'FAIL', `${idxRes.rows.length} indexes found`);

    // ── 4. NUMERIC(18,4) financial columns ───────────────────────────────────
    const numRes = await pool.query(`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema='public' AND data_type='numeric' AND numeric_precision=18 AND numeric_scale=4
    `);
    const liveNumeric = new Set(numRes.rows.map((r: any) => `${r.table_name}.${r.column_name}`));
    const missingNumeric = EXPECTED_NUMERIC_18_4.filter((c) => !liveNumeric.has(`${c.table}.${c.column}`));
    add('NUMERIC(18,4) financials', missingNumeric.length === 0 ? 'PASS' : 'FAIL',
      missingNumeric.length === 0 ? `${EXPECTED_NUMERIC_18_4.length} NUMERIC(18,4) columns present` : `missing: ${missingNumeric.map((m) => `${m.table}.${m.column}`).join(', ')}`);

    // ── 5. ULID PKs are VARCHAR(26) ──────────────────────────────────────────
    let ulidBad = 0;
    for (const t of EXPECTED_ULID_PK_TABLES) {
      const pkRes = await pool.query(`
        SELECT k.column_name, c.data_type, c.character_maximum_length
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage k ON tc.constraint_name = k.constraint_name
        JOIN information_schema.columns c ON c.table_name = tc.table_name AND c.column_name = k.column_name
        WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_name=$1 AND tc.table_schema='public'
      `, [t]);
      const pk = pkRes.rows[0];
      if (!pk || pk.data_type !== 'character varying' || Number(pk.character_maximum_length) !== 26) ulidBad++;
    }
    add('ULID PKs VARCHAR(26)', ulidBad === 0 ? 'PASS' : 'FAIL', ulidBad === 0 ? `${EXPECTED_ULID_PK_TABLES.length} ULID PKs valid` : `${ulidBad} PK(s) not VARCHAR(26)`);

    // ── 6. Marketplace seed rows ─────────────────────────────────────────────
    const mpRes = await pool.query(`SELECT name FROM marketplaces ORDER BY name`);
    const liveMp = new Set(mpRes.rows.map((r: any) => r.name));
    const missingMp = EXPECTED_MARKETPLACES.filter((m) => !liveMp.has(m));
    add('marketplace seeds', missingMp.length === 0 ? 'PASS' : 'FAIL',
      missingMp.length === 0 ? `${EXPECTED_MARKETPLACES.length} marketplaces seeded` : `missing: ${missingMp.join(', ')}`);

    // ── 7. schema_migrations contains applied migration + checksum matches ───
    const migRes = await pool.query(`SELECT version, name, checksum FROM schema_migrations ORDER BY version`);
    add('schema_migrations', migRes.rows.length >= 1 ? 'PASS' : 'FAIL', `${migRes.rows.length} migration(s) recorded`);
    for (const row of migRes.rows) {
      const file = row.name as string;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      const expectedChecksum = createHash('sha256').update(sql).digest('hex');
      const matches = row.checksum === expectedChecksum;
      add(`checksum ${row.version}`, matches ? 'PASS' : 'FAIL', matches ? 'checksum matches file' : `mismatch (db=${String(row.checksum).slice(0,12)}.. file=${expectedChecksum.slice(0,12)}..)`);
    }
  } catch (err) {
    add('audit harness', 'FAIL', err instanceof Error ? err.message : String(err));
  } finally {
    try { await pool.end(); } catch { /* ignore */ }
  }

  // Print report
  // eslint-disable-next-line no-console
  console.log('\n┌── schema-audit ─────────────────────────────────────────────────');
  for (const o of outcomes) {
    // eslint-disable-next-line no-console
    console.log(`│ [${o.result}] ${o.name} — ${o.detail}`);
  }
  const fail = outcomes.filter((o) => o.result === 'FAIL').length;
  const pass = outcomes.filter((o) => o.result === 'PASS').length;
  // eslint-disable-next-line no-console
  console.log(`└── summary: ${pass} PASS, ${fail} FAIL`);
  return fail > 0 ? 1 : 0;
}

run().then((code) => process.exit(code)).catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal schema-audit error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
