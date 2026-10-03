/**
 * Shopify Admin API version for every Brain Admin call.
 *
 * Default is the latest stable version (2026-10) from
 * https://shopify.dev/docs/api/usage/versioning as of 2026-10-03.
 * Override with SHOPIFY_API_VERSION. createAdminClient is the only caller.
 */
export const SHOPIFY_API_VERSION_DEFAULT = "2026-10";

const SHOPIFY_API_VERSION_PATTERN = /^\d{4}-\d{2}$|^unstable$/;

export function shopifyApiVersion(env: Record<string, string | undefined> = process.env): string {
  const override = env.SHOPIFY_API_VERSION?.trim();
  if (!override) return SHOPIFY_API_VERSION_DEFAULT;
  if (!SHOPIFY_API_VERSION_PATTERN.test(override)) return SHOPIFY_API_VERSION_DEFAULT;
  return override;
}
