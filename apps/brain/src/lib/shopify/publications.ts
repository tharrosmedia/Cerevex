const cachedPubIds = new Map<string, { id: string; ts: number }>();
const PUB_CACHE_MS = 1000 * 60 * 5; // 5 min

type PublicationClient = {
  session?: { shop?: string | null };
  request: (query: string, options?: { variables?: unknown }) => Promise<unknown>;
};

/** Per-store cache key. A missing key means do not cache (never a process-global id). */
export function publicationCacheKey(adminClient: PublicationClient | null | undefined, storeId?: string | null): string | null {
  const explicit = (storeId || '').trim();
  if (explicit) return `store:${explicit}`;
  const shop = adminClient?.session?.shop;
  if (typeof shop === 'string' && shop.trim()) return `shop:${shop.trim().toLowerCase()}`;
  return null;
}

export function clearPublicationCache(): void {
  cachedPubIds.clear();
}

export async function getOnlineStorePublicationId(adminClient: PublicationClient, storeId?: string | null): Promise<string> {
  const now = Date.now();
  const key = publicationCacheKey(adminClient, storeId);
  if (key) {
    const hit = cachedPubIds.get(key);
    if (hit && now - hit.ts < PUB_CACHE_MS) return hit.id;
  }
  const query = `
    query {
      publications(first: 10) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;
  const response = (await adminClient.request(query, {})) as {
    data?: { publications?: { edges?: Array<{ node?: { id?: string; name?: string } }> } };
  };
  const pubs = response?.data?.publications?.edges || [];
  const online = pubs.find((e) => (e.node?.name || '').toLowerCase().includes('online'));
  const pub = online ? online.node : pubs[0]?.node;
  if (!pub?.id) {
    throw new Error('No Online Store publication found. Ensure the Online Store sales channel is enabled.');
  }
  if (key) cachedPubIds.set(key, { id: pub.id, ts: now });
  return pub.id;
}

export async function publishResource(adminClient: PublicationClient, resourceId: string, publicationId: string) {
  const mutation = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `;
  const response = (await adminClient.request(mutation, {
    variables: { id: resourceId, input: [{ publicationId }] },
  })) as { data?: { publishablePublish?: { userErrors?: Array<{ message?: string }> } } };
  const errors = response?.data?.publishablePublish?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return response;
}
