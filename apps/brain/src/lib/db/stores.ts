import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import { encrypt, decrypt } from '../encryption';
import { cookies } from 'next/headers';
import { toSafeJsonb } from './safe-json';

export async function listStores() {
  const sql = neon(process.env.DATABASE_URL!);
  return sql`SELECT id, name, shopify_domain, platform, config, created_at FROM stores ORDER BY created_at DESC`;
}

export async function getStore(id: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`SELECT id, name, shopify_domain, shopify_access_token, platform, config FROM stores WHERE id = ${id}`;
  const row = result[0];
  if (row && row.shopify_access_token) {
    try {
      row.shopify_access_token = decrypt(row.shopify_access_token, process.env.ENCRYPTION_KEY!);
    } catch (e) {
      // If decryption fails (e.g. old plaintext or bad key), clear it so callers get clear "no token" errors
      console.warn('Failed to decrypt token for store', id, '— may be plaintext or wrong key');
      row.shopify_access_token = '';
    }
  }
  return row;
}

export async function createStore({ name, shopify_domain, shopify_access_token, platform = 'shopify', config }: { name: string; shopify_domain: string; shopify_access_token: string; platform?: string; config?: any }) {
  const sql = neon(process.env.DATABASE_URL!);
  const encryptedToken = encrypt(shopify_access_token, process.env.ENCRYPTION_KEY!);
  const safeConfig = toSafeJsonb(config, 'store.config');
  const result = await sql`INSERT INTO stores (name, shopify_domain, shopify_access_token, platform, config) VALUES (${name}, ${shopify_domain}, ${encryptedToken}, ${platform}, ${safeConfig}) RETURNING id, name, shopify_domain, platform, config, created_at`;
  return result[0];
}

export async function updateStore(id: string, { name, shopify_domain, shopify_access_token, platform = 'shopify', config }: { name: string; shopify_domain: string; shopify_access_token: string; platform?: string; config?: any }) {
  const sql = neon(process.env.DATABASE_URL!);
  const safeConfig = config !== undefined ? toSafeJsonb(config, 'store.config') : null;
  if (shopify_access_token && shopify_access_token.length > 0) {
    const encrypted = encrypt(shopify_access_token, process.env.ENCRYPTION_KEY!);
    const result = await sql`UPDATE stores SET name = ${name}, shopify_domain = ${shopify_domain}, shopify_access_token = ${encrypted}, platform = ${platform}, config = ${safeConfig}, updated_at = now() WHERE id = ${id} RETURNING id, name, shopify_domain, platform, config, created_at`;
    return result[0];
  } else {
    const result = await sql`UPDATE stores SET name = ${name}, shopify_domain = ${shopify_domain}, platform = ${platform}, config = ${safeConfig}, updated_at = now() WHERE id = ${id} RETURNING id, name, shopify_domain, platform, config, created_at`;
    return result[0];
  }
}

export async function getActiveStoreId(): Promise<string | null> {
  const cookieStore = await cookies();
  let storeId = cookieStore.get('activeStoreId')?.value || null;
  const stores = await listStores();
  if (!storeId || storeId === 'undefined' || !stores.some((s: any) => s.id === storeId)) {
    if (stores.length === 0) return null;
    storeId = stores[0].id;
  }
  return storeId;
}
