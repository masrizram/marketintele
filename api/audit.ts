import { json, requireAdmin, withServerlessDb, APP_VERSION, VercelRequest, VercelResponse } from './_lib/http';

/**
 * GET /api/audit
 *
 * Admin-protected status endpoint. Requires `x-admin-api-key` header matching
 * the ADMIN_API_KEY environment variable. Returns:
 *   - schema version (latest migration)
 *   - row counts for key tables
 *   - app version
 * Never returns secrets or raw payloads.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;

  try {
    const status = await withServerlessDb(async (pool) => {
      const versionRow = await pool.query(
        'SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1',
      );
      const counts: Record<string, number> = {};
      const tables = ['sources', 'suppliers', 'products', 'marketplace_listings', 'opportunities', 'opportunity_scores', 'audit_logs'];
      for (const t of tables) {
        try {
          const r = await pool.query(`SELECT count(*) AS n FROM ${t}`);
          counts[t] = Number(r.rows[0]?.n ?? 0);
        } catch {
          counts[t] = -1; // table missing / query failed
        }
      }
      return {
        version: APP_VERSION,
        latestMigration: versionRow.rows[0] ?? null,
        counts,
        timestamp: new Date().toISOString(),
      };
    });
    json(res, 200, status);
  } catch (err) {
    json(res, 500, { error: 'Database unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
}
