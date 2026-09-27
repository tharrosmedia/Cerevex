import { seoMetafields } from './seo-metafields';

type PageInput = { title?: string; handle?: string; bodyHtml?: string; seoTitle?: string; seoDescription?: string };

function throwUserErrors(errors: any[] | undefined) {
  if (errors && errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
}

export async function createAndPublishPage(adminClient: any, input: PageInput & { title: string }) {
  const mutation = `
    mutation createPage($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id handle }
        userErrors { field message }
      }
    }
  `;
  const page: Record<string, unknown> = {
    title: input.title,
    handle: input.handle,
    body: input.bodyHtml || '',
    isPublished: true,
  };
  const metafields = seoMetafields(input.seoTitle, input.seoDescription);
  if (metafields.length) page.metafields = metafields;
  const response = await adminClient.request(mutation, { variables: { page } });
  throwUserErrors(response?.data?.pageCreate?.userErrors);
  if (!response?.data?.pageCreate?.page?.id) {
    throw new Error('Failed to create page');
  }
  return response;
}

// Back-compat alias
export const createDraftPage = createAndPublishPage;

export async function updatePage(adminClient: any, id: string, input: PageInput) {
  const mutation = `
    mutation updatePage($id: ID!, $page: PageUpdateInput!) {
      pageUpdate(id: $id, page: $page) {
        page { id handle }
        userErrors { field message }
      }
    }
  `;
  const page: Record<string, unknown> = {};
  if (input.title) page.title = input.title;
  if (input.handle) page.handle = input.handle;
  // An empty body here means the content was placed in metafields; don't wipe the live page.
  if (input.bodyHtml) page.body = input.bodyHtml;
  const metafields = seoMetafields(input.seoTitle, input.seoDescription);
  if (metafields.length) page.metafields = metafields;
  const response = await adminClient.request(mutation, { variables: { id, page } });
  throwUserErrors(response?.data?.pageUpdate?.userErrors);
  return response;
}
