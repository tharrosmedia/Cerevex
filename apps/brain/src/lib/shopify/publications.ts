let cachedPubId: { id: string; ts: number } | null = null;
const PUB_CACHE_MS = 1000 * 60 * 5; // 5 min

export async function getOnlineStorePublicationId(adminClient: any): Promise<string> {
  const now = Date.now();
  if (cachedPubId && (now - cachedPubId.ts) < PUB_CACHE_MS) {
    return cachedPubId.id;
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
  const response = await adminClient.request(query, {});
  const pubs = response?.data?.publications?.edges || [];
  const online = pubs.find((e: any) => (e.node?.name || '').toLowerCase().includes('online'));
  const pub = online ? online.node : pubs[0]?.node;
  if (!pub?.id) {
    throw new Error('No Online Store publication found. Ensure the Online Store sales channel is enabled.');
  }
  cachedPubId = { id: pub.id, ts: now };
  return pub.id;
}

export async function publishResource(adminClient: any, resourceId: string, publicationId: string) {
  const mutation = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `;
  const response = await adminClient.request(mutation, {
    variables: { id: resourceId, input: [{ publicationId }] },
  });
  const errors = response?.data?.publishablePublish?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  return response;
}
