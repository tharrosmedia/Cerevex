import { seoMetafields } from './seo-metafields';

type ArticleInput = { title?: string; handle?: string; bodyHtml?: string; seoTitle?: string; seoDescription?: string; authorName?: string };

function throwUserErrors(errors: any[] | undefined) {
  if (errors && errors.length) {
    throw new Error(errors.map((e: any) => e.message).join('; '));
  }
}

export async function getFirstBlog(adminClient: any): Promise<{ id: string; handle: string }> {
  const query = `
    query getFirstBlog {
      blogs(first: 1) {
        edges {
          node {
            id
            handle
          }
        }
      }
    }
  `;
  const response = await adminClient.request(query, {});
  const blog = response?.data?.blogs?.edges?.[0]?.node;
  if (!blog?.id) {
    throw new Error('No blogs found in this Shopify store. Create at least one blog to publish blog posts.');
  }
  return { id: blog.id, handle: blog.handle || 'blog' };
}

export async function getFirstBlogId(adminClient: any): Promise<string> {
  const blog = await getFirstBlog(adminClient);
  return blog.id;
}

export async function createAndPublishArticle(adminClient: any, input: ArticleInput & { title: string }) {
  const blogId = await getFirstBlogId(adminClient);
  const mutation = `
    mutation createArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id handle }
        userErrors { field message }
      }
    }
  `;
  const article: Record<string, unknown> = {
    blogId,
    title: input.title,
    handle: input.handle,
    body: input.bodyHtml || '',
    isPublished: true,
    author: { name: input.authorName?.trim() || 'Staff' },
  };
  const metafields = seoMetafields(input.seoTitle, input.seoDescription);
  if (metafields.length) article.metafields = metafields;
  const response = await adminClient.request(mutation, { variables: { article } });
  throwUserErrors(response?.data?.articleCreate?.userErrors);
  if (!response?.data?.articleCreate?.article?.id) {
    throw new Error('Failed to create article');
  }
  return response;
}

export async function updateArticle(adminClient: any, id: string, input: ArticleInput) {
  const mutation = `
    mutation updateArticle($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id handle }
        userErrors { field message }
      }
    }
  `;
  const article: Record<string, unknown> = {};
  if (input.title) article.title = input.title;
  if (input.handle) article.handle = input.handle;
  // An empty body here means the content was placed in metafields; don't wipe the live article.
  if (input.bodyHtml) article.body = input.bodyHtml;
  const metafields = seoMetafields(input.seoTitle, input.seoDescription);
  if (metafields.length) article.metafields = metafields;
  const response = await adminClient.request(mutation, { variables: { id, article } });
  throwUserErrors(response?.data?.articleUpdate?.userErrors);
  return response;
}

// Back-compat alias
export const createDraftArticle = createAndPublishArticle;
