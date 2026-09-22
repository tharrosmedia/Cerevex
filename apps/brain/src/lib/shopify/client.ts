import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

export function createAdminClient(shopDomain: string, accessToken: string) {
  const shopify = shopifyApi({
    apiKey: 'not-needed',
    apiSecretKey: 'not-needed',
    apiVersion: ApiVersion.July25,
    scopes: [],
    hostName: shopDomain,
    isEmbeddedApp: false,
  });
  const session = shopify.session.customAppSession(shopDomain);
  (session as any).accessToken = accessToken;
  return new shopify.clients.Graphql({ session });
}
