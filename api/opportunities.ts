import { json, withServerlessDb, VercelRequest, VercelResponse } from './_lib/http';

/**
 * GET /api/opportunities
 *   ?limit=N   (default 20, max 100)
 *   ?offset=M
 *   ?state=ACTIVE|WEAKENING|DECAYING|...
 *   ?tier=S|A|B|C
 *
 * Read-only listing of persisted opportunities. Never exposes secrets.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const limit = clamp(parseInt(String(req.query?.limit ?? '20'), 10) || 20, 1, 100);
  const offset = Math.max(0, parseInt(String(req.query?.offset ?? '0'), 10) || 0);
  const state = typeof req.query?.state === 'string' ? req.query.state : null;
  const tier = typeof req.query?.tier === 'string' ? req.query.tier : null;

  try {
    const rows = await withServerlessDb(async (pool) => {
      const where: string[] = [];
      const params: (string | number)[] = [];
      let p = 1;
      if (state) { where.push(`o.state = $${p++}`); params.push(state); }
      if (tier)  { where.push(`o.quality_tier = $${p++}`); params.push(tier); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      params.push(limit, offset);
      const q = `
        SELECT o.id, o.state, o.quality_tier, o.created_at, o.updated_at,
               o.product_id, o.supplier_id, o.marketplace_id,
               o.expected_value, o.action, o.total_score
        FROM opportunities o
        ${whereSql}
        ORDER BY o.created_at DESC
        LIMIT $${p++} OFFSET $${p++}
      `;
      const r = await pool.query(q, params);
      return r.rows;
    });

    json(res, 200, {
      data: rows,
      pagination: { limit, offset, count: rows.length },
      provenance: 'REAL',
    });
  } catch (err) {
    json(res, 500, { error: 'Database unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
