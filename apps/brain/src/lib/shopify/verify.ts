import { createAdminClient } from './client';
import { describeShopifyError } from './catalog';

/**
 * Permissions the console's Shopify queries and publish mutations use.
 * Collections are covered by the products scopes; pages and blog posts by content.
 */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products',
  'write_products',
  'read_content',
  'write_content',
  'read_publications',
  'write_publications',
] as const;

/** Accepts "mystore", "mystore.myshopify.com", or a full admin/storefront URL. */
export function normalizeShopDomain(input: string | null | undefined): string | null {
  let value = (input || '').trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\//, '').replace(/^admin\.shopify\.com\/store\//, '');
  value = value.split(/[/?#]/)[0];
  if (!value) return null;
  if (!value.includes('.')) value = `${value}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) return null;
  return value;
}

export function missingShopifyScopes(granted: string[]): string[] {
  const have = new Set(granted);
  // write_* implies read_* for Shopify access scopes.
  return SHOPIFY_REQUIRED_SCOPES.filter((scope) => {
    if (have.has(scope)) return false;
    if (scope.startsWith('read_') && have.has(scope.replace(/^read_/, 'write_'))) return false;
    return true;
  });
}

export type ShopifyVerifyResult =
  | { ok: true; shopName: string; missingScopes: string[] }
  | { ok: false; error: string };

export async function verifyShopifyClient(client: { request: (q: string, o?: any) => Promise<any> }): Promise<ShopifyVerifyResult> {
  try {
    const res = await client.request(`{ shop { name } currentAppInstallation { accessScopes { handle } } }`, {});
    const shopName = res?.data?.shop?.name;
    if (!shopName) return { ok: false, error: 'Shopify did not return the shop. Check the store address and token.' };
    const granted: string[] = (res?.data?.currentAppInstallation?.accessScopes || []).map((s: any) => s?.handle).filter(Boolean);
    return { ok: true, shopName, missingScopes: missingShopifyScopes(granted) };
  } catch (e) {
    return { ok: false, error: describeShopifyError(e) };
  }
}

export async function verifyShopifyConnection(domain: string, accessToken: string): Promise<ShopifyVerifyResult> {
  return verifyShopifyClient(createAdminClient(domain, accessToken));
}
