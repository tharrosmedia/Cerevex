export const SHOPIFY_NOT_CONNECTED = 'shopify_not_connected' as const;

export const SHOPIFY_NOT_CONNECTED_MESSAGE = "Shopify isn't connected for this store yet.";

export type ShopifyNotConnectedSkip = {
  skipped: typeof SHOPIFY_NOT_CONNECTED;
  message: typeof SHOPIFY_NOT_CONNECTED_MESSAGE;
};

type TokenStore = { shopify_access_token?: string | null } | null | undefined;

/** A Shopify Admin API token is present. Blank and whitespace-only values are not a connection. */
export function hasShopifyAccessToken<T extends TokenStore>(
  store: T,
): store is T & { shopify_access_token: string } {
  if (!store) return false;
  const token = store.shopify_access_token;
  return typeof token === 'string' && token.trim().length > 0;
}

export function shopifyNotConnectedSkip(): ShopifyNotConnectedSkip {
  return { skipped: SHOPIFY_NOT_CONNECTED, message: SHOPIFY_NOT_CONNECTED_MESSAGE };
}

export function isShopifyNotConnectedSkip(value: unknown): value is ShopifyNotConnectedSkip {
  if (!value || typeof value !== 'object') return false;
  return (value as { skipped?: unknown }).skipped === SHOPIFY_NOT_CONNECTED;
}

/** Worker log line. Store id only. Never a domain, token, or secret. */
export function logShopifySkip(scope: string, storeId: string): void {
  console.info(`[${scope}] skipped ${storeId}: ${SHOPIFY_NOT_CONNECTED_MESSAGE}`);
}
