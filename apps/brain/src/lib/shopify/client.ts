import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { shopifyApiVersion } from './api-version';

export function createAdminClient(shopDomain: string, accessToken: string) {
  const shopify = shopifyApi({
    apiKey: 'not-needed',
    apiSecretKey: 'not-needed',
    // The installed library enum stops at 2026-07. Shopify accepts the date
    // string in the Admin URL; the cast keeps that pin without an SDK upgrade.
    apiVersion: shopifyApiVersion() as ApiVersion,
    scopes: [],
    hostName: shopDomain,
    isEmbeddedApp: false,
  });
  const session = shopify.session.customAppSession(shopDomain);
  (session as any).accessToken = accessToken;
  return new shopify.clients.Graphql({ session });
}
