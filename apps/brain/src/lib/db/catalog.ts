import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

export async function upsertCatalogResource(storeId: string, r: any) {
  const sql = neon(process.env.DATABASE_URL!);
  const safeMf = toSafeJsonb(r.metafields, 'catalog.metafields');
  const result = await sql`
    INSERT INTO catalog_resources (store_id, shopify_id, resource_type, handle, title, seo_title, seo_description, body_html, metafields, product_count, published, shopify_updated_at, synced_at)
    VALUES (${storeId}, ${r.shopifyId}, ${r.resourceType}, ${r.handle || null}, ${r.title || null}, ${r.seoTitle || null}, ${r.seoDescription || null}, ${r.bodyHtml || null}, ${safeMf}, ${r.productCount ?? null}, ${r.published ?? null}, ${r.shopifyUpdatedAt || null}, now())
    ON CONFLICT (store_id, shopify_id)
    DO UPDATE SET
      resource_type = EXCLUDED.resource_type,
      handle = EXCLUDED.handle,
      title = EXCLUDED.title,
      seo_title = EXCLUDED.seo_title,
      seo_description = EXCLUDED.seo_description,
      body_html = EXCLUDED.body_html,
      metafields = EXCLUDED.metafields,
      product_count = EXCLUDED.product_count,
      published = EXCLUDED.published,
      shopify_updated_at = EXCLUDED.shopify_updated_at,
      synced_at = now()
    RETURNING id
  `;
  return result[0];
}

export async function listCatalogResources(storeId: string, limit = 200, type?: string) {
  const sql = neon(process.env.DATABASE_URL!);
  if (type) {
    return sql`SELECT id, store_id as "storeId", shopify_id as "shopifyId", resource_type as "resourceType", handle, title, seo_title as "seoTitle", seo_description as "seoDescription", body_html as "bodyHtml", metafields, product_count as "productCount", published, shopify_updated_at as "shopifyUpdatedAt", synced_at as "syncedAt" FROM catalog_resources WHERE store_id = ${storeId} AND resource_type = ${type} ORDER BY synced_at DESC LIMIT ${limit}`;
  }
  return sql`SELECT id, store_id as "storeId", shopify_id as "shopifyId", resource_type as "resourceType", handle, title, seo_title as "seoTitle", seo_description as "seoDescription", body_html as "bodyHtml", metafields, product_count as "productCount", published, shopify_updated_at as "shopifyUpdatedAt", synced_at as "syncedAt" FROM catalog_resources WHERE store_id = ${storeId} ORDER BY synced_at DESC LIMIT ${limit}`;
}

export async function getCatalogResourceByShopifyId(storeId: string, shopifyId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const res = await sql`SELECT * FROM catalog_resources WHERE store_id = ${storeId} AND shopify_id = ${shopifyId} LIMIT 1`;
  return res[0] || null;
}
