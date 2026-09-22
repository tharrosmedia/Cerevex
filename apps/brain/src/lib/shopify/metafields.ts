export async function setMetafields(adminClient: any, ownerId: string, metafields: Array<{ namespace: string; key: string; value: string; type: string }>) {
  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }
  `;
  const input = metafields.map(m => ({
    ownerId,
    namespace: m.namespace,
    key: m.key,
    value: m.value,
    type: m.type,
  }));
  const response = await adminClient.request(mutation, { variables: { metafields: input } });
  const errors = response?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  return response;
}
