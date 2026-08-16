import { json, withServerlessDb, VercelRequest, VercelResponse } from './_lib/http';

/**
 * GET /api/products
 *   ?limit=N   (default 20, max 100)
 *   ?offset=M
 *
 * Read-only listing of products. Never exposes secrets.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed' });
    return;
  }

  const limit = clamp(parseInt(String(req.query?.limit ?? '20'), 10) || 20, 1, 100);
  const offset = Math.max(0, parseInt(String(req.query?.offset ?? '0'), 10) || 0);

  try {
    const rows = await withServerlessDb(async (pool) => {
      const r = await pool.query(
        `SELECT id, canonical_title, brand, model, standard_unit, created_at, updated_at
         FROM products
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return r.rows;
    });

    json(res, 200, {
      data: rows,
      pagination: { limit, offset, count: rows.length },
    });
  } catch (err) {
    json(res, 500, { error: 'Database unavailable', detail: err instanceof Error ? err.message : String(err) });
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
