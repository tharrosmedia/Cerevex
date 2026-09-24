import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

export async function upsertGscRows(storeId: string, rows: any[]) {
  const sql = neon(process.env.DATABASE_URL!);
  let n = 0;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO gsc_rows (store_id, date_start, date_end, query, page, clicks, impressions, ctr, position)
        VALUES (${storeId}, ${r.date_start || null}, ${r.date_end || null}, ${r.query}, ${r.page}, ${r.clicks}, ${r.impressions}, ${r.ctr}, ${r.position})
        ON CONFLICT DO NOTHING
      `;
      n++;
    } catch (e) { console.warn('gsc row upsert fail', e); }
  }
  return { inserted: n };
}

export async function listGscRows(storeId: string, limit = 500) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    return await sql`
      SELECT id, store_id as "storeId", date_start as "dateStart", date_end as "dateEnd", query, page, clicks, impressions, ctr, position, created_at as "createdAt"
      FROM gsc_rows WHERE store_id = ${storeId} ORDER BY date_end DESC, impressions DESC LIMIT ${limit}
    `;
  } catch { return []; }
}

export async function summarizeGscRows(storeId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const rows = await sql`
      SELECT
        count(*)::int as rows,
        count(DISTINCT query)::int as queries,
        count(DISTINCT page)::int as pages,
        coalesce(sum(impressions), 0)::int as impressions,
        coalesce(sum(clicks), 0)::int as clicks,
        min(date_start) as "dateStart",
        max(date_end) as "dateEnd"
      FROM gsc_rows
      WHERE store_id = ${storeId}
    `;
    return rows[0] || { rows: 0, queries: 0, pages: 0, impressions: 0, clicks: 0, dateStart: null, dateEnd: null };
  } catch {
    return { rows: 0, queries: 0, pages: 0, impressions: 0, clicks: 0, dateStart: null, dateEnd: null };
  }
}
