import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';
import {
  GSC_REC_KINDS,
  gscRecommendationDetail,
  type GscRecommendation,
} from '../seo/gsc-recommendations';

export type FindingStatus = 'open' | 'queued' | 'dismissed' | 'snoozed' | 'denied';

const GSC_KIND_SQL = GSC_REC_KINDS as unknown as string[];

export async function listOpenFindings(storeId: string, limit = 50) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    return await sql`
      SELECT id, store_id as "storeId", catalog_id as "catalogId", shopify_id as "shopifyId", handle, resource_type as "resourceType",
             kind, severity, title, detail, status, cluster_key as "clusterKey", score, source, created_at as "createdAt"
      FROM seo_findings
      WHERE store_id = ${storeId} AND status = 'open'
      ORDER BY COALESCE(score, 0) DESC, created_at DESC
      LIMIT ${limit}
    `;
  } catch {
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
  clusterKey?: string | null; score?: number | null; source?: string | null;
}) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const safeDetail = toSafeJsonb(f.detail, 'finding.detail');
    if (f.clusterKey) {
      const existing = await sql`
        SELECT id FROM seo_findings
        WHERE store_id = ${f.storeId} AND kind = ${f.kind} AND COALESCE(cluster_key, '') = ${f.clusterKey} AND status = 'open'
        LIMIT 1
      `;
      if (existing[0]) {
        await sql`
          UPDATE seo_findings
          SET catalog_id = ${f.catalogId || null},
              shopify_id = ${f.shopifyId || null},
              handle = ${f.handle},
              resource_type = ${f.resourceType},
              severity = ${f.severity},
              title = ${f.title},
              detail = ${safeDetail},
              score = ${f.score ?? null},
              source = ${f.source || 'gsc'}
          WHERE id = ${existing[0].id}
        `;
        return existing[0];
      }
    }
    const ins = await sql`
      INSERT INTO seo_findings (store_id, catalog_id, shopify_id, handle, resource_type, kind, severity, title, detail, status, cluster_key, score, source)
      VALUES (${f.storeId}, ${f.catalogId || null}, ${f.shopifyId || null}, ${f.handle}, ${f.resourceType}, ${f.kind}, ${f.severity}, ${f.title}, ${safeDetail}, ${f.status || 'open'}, ${f.clusterKey || null}, ${f.score ?? null}, ${f.source || null})
      ON CONFLICT (store_id, COALESCE(shopify_id, ''), kind) WHERE status = 'open' DO NOTHING
      RETURNING id
    `;
    if (ins[0]) return ins[0];
    const ex = await sql`SELECT id FROM seo_findings WHERE store_id = ${f.storeId} AND COALESCE(shopify_id,'') = COALESCE(${f.shopifyId || ''},'') AND kind = ${f.kind} AND status='open' LIMIT 1`;
    return ex[0] || null;
  } catch {
    return null;
  }
}

export async function setFindingStatus(id: string, status: FindingStatus) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    await sql`UPDATE seo_findings SET status = ${status} WHERE id = ${id}`;
  } catch {}
}

export async function replaceOpenGscRecommendations(storeId: string, recs: GscRecommendation[]) {
  const keep = recs.map((rec) => rec.clusterKey);
  for (const rec of recs) {
    await upsertOpenFinding({
      storeId,
      catalogId: rec.catalogId,
      shopifyId: rec.shopifyId,
      handle: rec.handle,
      resourceType: rec.resourceType,
      kind: rec.recType,
      severity: rec.severity,
      title: rec.title,
      detail: gscRecommendationDetail(rec),
      clusterKey: rec.clusterKey,
      score: rec.score,
      source: 'gsc',
    });
  }
  const sql = neon(process.env.DATABASE_URL!);
  try {
    if (keep.length === 0) {
      await sql`
        UPDATE seo_findings
        SET status = 'dismissed'
        WHERE store_id = ${storeId} AND status = 'open' AND kind = ANY(${GSC_KIND_SQL})
      `;
    } else {
      await sql`
        UPDATE seo_findings
        SET status = 'dismissed'
        WHERE store_id = ${storeId}
          AND status = 'open'
          AND kind = ANY(${GSC_KIND_SQL})
          AND COALESCE(cluster_key, '') <> ALL(${keep})
      `;
    }
  } catch {}
  return { upserted: recs.length };
}
