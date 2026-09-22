import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

export async function listOpenFindings(storeId: string, limit = 50) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    return await sql`
      SELECT id, store_id as "storeId", catalog_id as "catalogId", shopify_id as "shopifyId", handle, resource_type as "resourceType",
             kind, severity, title, detail, status, created_at as "createdAt"
      FROM seo_findings
      WHERE store_id = ${storeId} AND status = 'open'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } catch {
    return [];
  }
}

export async function countOpenFindings(storeId: string): Promise<number> {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const res = await sql`SELECT count(*)::int as c FROM seo_findings WHERE store_id = ${storeId} AND status = 'open'`;
    return res[0]?.c || 0;
  } catch {
    return 0;
  }
}

export async function upsertOpenFinding(f: {
  storeId: string; catalogId?: string | null; shopifyId?: string | null; handle: string; resourceType: string;
  kind: string; severity: 'high'|'med'|'low'; title: string; detail?: any; status?: string;
}) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const safeDetail = toSafeJsonb(f.detail, 'finding.detail');
    // Use try insert + select if conflict on open
    const ins = await sql`
      INSERT INTO seo_findings (store_id, catalog_id, shopify_id, handle, resource_type, kind, severity, title, detail, status)
      VALUES (${f.storeId}, ${f.catalogId || null}, ${f.shopifyId || null}, ${f.handle}, ${f.resourceType}, ${f.kind}, ${f.severity}, ${f.title}, ${safeDetail}, ${f.status || 'open'})
      ON CONFLICT (store_id, COALESCE(shopify_id, ''), kind) WHERE status = 'open' DO NOTHING
      RETURNING id
    `;
    if (ins[0]) return ins[0];
    // if existed, fetch one
    const ex = await sql`SELECT id FROM seo_findings WHERE store_id = ${f.storeId} AND COALESCE(shopify_id,'') = COALESCE(${f.shopifyId || ''},'') AND kind = ${f.kind} AND status='open' LIMIT 1`;
    return ex[0] || null;
  } catch { return null; }
}

export async function setFindingStatus(id: string, status: 'open'|'queued'|'dismissed') {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    await sql`UPDATE seo_findings SET status = ${status} WHERE id = ${id}`;
  } catch {}
}
