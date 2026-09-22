import { getOnlineStorePublicationId, publishResource } from './publications';

export async function createAndPublishCollection(adminClient: any, input: { title: string; handle?: string; bodyHtml?: string; seoTitle?: string; seoDescription?: string; }) {
  const mutation = `
    mutation createCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id handle }
        userErrors { field message }
      }
    }
  `;
  const variables: any = {
    input: {
      title: input.title,
      handle: input.handle,
      descriptionHtml: input.bodyHtml || '',
    },
  };
  if (input.seoTitle || input.seoDescription) {
    variables.input.seo = {
      title: input.seoTitle || undefined,
      description: input.seoDescription || undefined,
    };
  }
  const response = await adminClient.request(mutation, { variables });
  const errors = response?.data?.collectionCreate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  const collection = response?.data?.collectionCreate?.collection;
  if (!collection?.id) {
    throw new Error('Failed to create collection');
  }
  const pubId = await getOnlineStorePublicationId(adminClient);
  await publishResource(adminClient, collection.id, pubId);
  return response;
}

export async function updateCollection(adminClient: any, id: string, input: { title?: string; handle?: string; bodyHtml?: string; seoTitle?: string; seoDescription?: string }) {
  const mutation = `
    mutation updateCollection($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id handle }
        userErrors { field message }
      }
    }
  `;
  const variables: any = {
    input: {
      id,
      title: input.title,
      handle: input.handle,
      descriptionHtml: input.bodyHtml || '',
    },
  };
  if (input.seoTitle || input.seoDescription) {
    variables.input.seo = { title: input.seoTitle || undefined, description: input.seoDescription || undefined };
  }
  const response = await adminClient.request(mutation, { variables });
  const errors = response?.data?.collectionUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  return response;
}

// Back-compat alias (used by tests and older references)
export const createDraftCollection = createAndPublishCollection;

export async function addProductsToCollection(adminClient: any, collectionId: string, productIds: string[]) {
  const mutation = `
    mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
      collectionAddProducts(id: $id, productIds: $productIds) {
        userErrors { field message }
      }
    }
  `;
  const response = await adminClient.request(mutation, { variables: { id: collectionId, productIds } });
  const errors = response?.data?.collectionAddProducts?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  return response;
}

export async function setCollectionRules(adminClient: any, collectionId: string, rules: any[]) {
  const mutation = `
    mutation collectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id }
        userErrors { field message }
      }
    }
  `;
  const input: any = {
    id: collectionId,
    ruleSet: {
      appliedDisjunctively: true,
      rules: rules || [],
    },
  };
  const response = await adminClient.request(mutation, { variables: { input } });
  const errors = response?.data?.collectionUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  return response;
}
