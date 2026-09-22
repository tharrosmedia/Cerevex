import { createAdminClient } from './client';

export async function fetchProducts(adminClient: any, options: { limit?: number; query?: string; includeMetafields?: boolean } = {}) {
  const { limit, query, includeMetafields = true } = options;
  const products: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage && (!limit || limit <= 0 || products.length < limit)) {
    const first = Math.min(50, (limit && limit > 0) ? limit - products.length : 50);
    const hasQuery = !!query;
    let q = `
      query($first: Int!, $after: String${hasQuery ? ', $query: String' : ''}) {
        products(first: $first, after: $after${hasQuery ? ', query: $query' : ''}, sortKey: ID) {
          edges {
            node {
              id
              title
              handle
              descriptionHtml
              productType
              tags
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
              ${includeMetafields ? `
              metafields(first: 5) {
                edges {
                  node {
                    namespace
                    key
                    value
                    type
                  }
                }
              }` : ''}
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const variables: any = { first, after: cursor };
    if (hasQuery) variables.query = query;
    const res = await adminClient.request(q, { variables });
    if (res.errors && res.errors.length > 0) {
      console.error('[Shopify] Products fetch errors:', res.errors);
      throw new Error(res.errors.map((e: any) => e.message || e).join('; '));
    }
    const edges = res?.data?.products?.edges || [];

    for (const e of edges) {
      const n = e.node;
      const imageUrl = n.images?.edges?.[0]?.node?.url || null;
      let metafields: any = null;
      if (n.metafields?.edges) {
        metafields = {};
        for (const me of n.metafields.edges) {
          const m = me.node;
          metafields[`${m.namespace}.${m.key}`] = m.value;
        }
      }
      products.push({
        shopifyId: n.id,
        title: n.title,
        handle: n.handle,
        descriptionHtml: n.descriptionHtml,
        imageUrl,
        productType: n.productType,
        tags: n.tags || [],
        metafields,
      });
      if (limit && limit > 0 && products.length >= limit) break;
    }

    const pageInfo = res?.data?.products?.pageInfo;
    hasNextPage = pageInfo?.hasNextPage && (!limit || limit <= 0 || products.length < limit);
    cursor = pageInfo?.endCursor || null;
  }

  return products;
}

export async function fetchProductsForKeyword(adminClient: any, keyword: string, limit = 20) {
  const searchQuery = `title:*${keyword}* OR handle:*${keyword}*`;
  return fetchProducts(adminClient, { limit, query: searchQuery, includeMetafields: true });
}
