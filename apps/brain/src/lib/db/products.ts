import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { toSafeJsonb } from './safe-json';

export async function upsertProduct(storeId: string, product: {
  shopifyId: string;
  title?: string;
  handle?: string;
  descriptionHtml?: string;
  imageUrl?: string;
  metafields?: any;
  productType?: string;
  tags?: string[];
}) {
  const sql = neon(process.env.DATABASE_URL!);
  const safeMf = toSafeJsonb(product.metafields, 'product.metafields');
  const result = await sql`
    INSERT INTO products (store_id, shopify_id, title, handle, description_html, image_url, metafields, product_type, tags, updated_at)
    VALUES (
      ${storeId},
      ${product.shopifyId},
      ${product.title || null},
      ${product.handle || null},
      ${product.descriptionHtml || null},
      ${product.imageUrl || null},
      ${safeMf},
      ${product.productType || null},
      ${product.tags || null},
      now()
    )
    ON CONFLICT (store_id, shopify_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      handle = EXCLUDED.handle,
      description_html = EXCLUDED.description_html,
      image_url = EXCLUDED.image_url,
      metafields = EXCLUDED.metafields,
      product_type = EXCLUDED.product_type,
      tags = EXCLUDED.tags,
      updated_at = now()
    RETURNING id, shopify_id as "shopifyId", title, handle, description_html as "descriptionHtml", image_url as "imageUrl", metafields, product_type as "productType", tags
  `;
  return result[0];
}

export async function listProducts(storeId: string, limit: number = 50) {
  const sql = neon(process.env.DATABASE_URL!);
  return sql`
    SELECT id, shopify_id as "shopifyId", title, handle, description_html as "descriptionHtml", image_url as "imageUrl", metafields, product_type as "productType", tags, created_at as "createdAt"
    FROM products
    WHERE store_id = ${storeId}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

export async function searchProducts(storeId: string, keyword: string, limit: number = 20) {
  const sql = neon(process.env.DATABASE_URL!);
  const q = '%' + keyword.toLowerCase() + '%';
  return sql`
    SELECT id, shopify_id as "shopifyId", title, handle, description_html as "descriptionHtml", image_url as "imageUrl", metafields, product_type as "productType", tags
    FROM products
    WHERE store_id = ${storeId}
      AND (LOWER(title) LIKE ${q} OR LOWER(handle) LIKE ${q} OR LOWER(description_html) LIKE ${q})
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
}

export async function getProductByHandle(storeId: string, handle: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    SELECT id, shopify_id as "shopifyId", title, handle, description_html as "descriptionHtml", image_url as "imageUrl", metafields, product_type as "productType", tags
    FROM products
    WHERE store_id = ${storeId} AND handle = ${handle}
    LIMIT 1
  `;
  return result[0];
}
