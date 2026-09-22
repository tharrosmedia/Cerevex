import { getOnlineStorePublicationId, publishResource } from './publications';

export async function createAndPublishPage(adminClient: any, input: { title: string; handle?: string; bodyHtml?: string; seoTitle?: string; seoDescription?: string }) {
  const mutation = `
    mutation createPage($input: PageInput!) {
      pageCreate(input: $input) {
        page { id handle }
        userErrors { field message }
      }
    }
  `;
  const variables: any = {
    input: {
      title: input.title,
      handle: input.handle,
      body: input.bodyHtml || '',
    },
  };
  if (input.seoTitle || input.seoDescription) {
    variables.input.seo = {
      title: input.seoTitle || undefined,
      description: input.seoDescription || undefined,
    };
  }
  const response = await adminClient.request(mutation, { variables });
  const errors = response?.data?.pageCreate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  const page = response?.data?.pageCreate?.page;
  if (!page?.id) {
    throw new Error('Failed to create page');
  }
  const pubId = await getOnlineStorePublicationId(adminClient);
  await publishResource(adminClient, page.id, pubId);
  return response;
}

// Back-compat alias
export const createDraftPage = createAndPublishPage;

export async function updatePage(adminClient: any, id: string, input: { title?: string; handle?: string; bodyHtml?: string; seoTitle?: string; seoDescription?: string }) {
  const mutation = `
    mutation updatePage($id: ID!, $input: PageInput!) {
      pageUpdate(id: $id, input: $input) {
        page { id handle }
        userErrors { field message }
      }
    }
  `;
  const variables: any = {
    id,
    input: {
      title: input.title,
      handle: input.handle,
      body: input.bodyHtml || '',
    },
  };
  if (input.seoTitle || input.seoDescription) {
    variables.input.seo = {
      title: input.seoTitle || undefined,
      description: input.seoDescription || undefined,
    };
  }
  const response = await adminClient.request(mutation, { variables });
  const errors = response?.data?.pageUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
  return response;
}
