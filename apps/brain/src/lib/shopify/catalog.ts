export type CatalogResourceType = 'collection' | 'page' | 'article';

export type CatalogFetchError = { resourceType: CatalogResourceType; message: string };

export type CatalogFetchResult = {
  resources: any[];
  counts: Record<CatalogResourceType, number>;
  errors: CatalogFetchError[];
};

const TYPE_PLURAL: Record<CatalogResourceType, string> = {
  collection: 'collections',
  page: 'pages',
  article: 'blog posts',
};

/** "Synced 42 collections and 8 pages. Blog posts failed: The Shopify token is missing the read_content permission." */
export function catalogSyncSummary(result: Pick<CatalogFetchResult, 'counts' | 'errors'>): string {
  const failed = new Set(result.errors.map((e) => e.resourceType));
  const parts = (Object.keys(TYPE_PLURAL) as CatalogResourceType[])
    .filter((t) => !failed.has(t))
    .map((t) => `${result.counts[t] ?? 0} ${TYPE_PLURAL[t]}`);
  const synced = parts.length
    ? `Synced ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`
    : 'Nothing synced.';
  const failures = result.errors.map((e) => {
    const label = TYPE_PLURAL[e.resourceType];
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} failed: ${e.message}`;
  });
  return [synced, ...failures].join(' ');
}

const PAGE_SIZE = 50;
const DEFAULT_LIMIT = 1000;

/** Turns a Shopify GraphQL failure into one sentence a merchant can act on. */
export function describeShopifyError(e: any): string {
  const graphQLErrors: any[] =
    e?.body?.errors?.graphQLErrors || e?.response?.errors?.graphQLErrors || e?.errors?.graphQLErrors || [];
  const text = [e?.message, ...graphQLErrors.map((g) => g?.message)].filter(Boolean).join(' ');
  const scope =
    graphQLErrors.map((g) => g?.extensions?.requiredAccess).find(Boolean) ||
    text.match(/Required access:\s*`?([a-z_]+)`?/i)?.[1] ||
    text.match(/requires? `?([a-z_]+)`? access scope/i)?.[1];
  if (scope) {
    const name = String(scope).replace(/[`\s]/g, '').replace(/accessscope\.?$/i, '');
    return `The Shopify token is missing the ${name} permission.`;
  }
  if (/401|unauthorized|invalid api key or access token/i.test(text)) {
    return 'Shopify rejected the access token. Replace it in Settings → Sites.';
  }
  if (/throttl/i.test(text)) return 'Shopify is rate-limiting requests. Try again in a minute.';
  return text ? text.slice(0, 200) : 'Shopify request failed.';
}

function metafieldRecord(node: any): Record<string, string> {
  const out: Record<string, string> = {};
  (node?.metafields?.edges || []).forEach((me: any) => {
    out[`${me.node.namespace}.${me.node.key}`] = me.node.value;
  });
  return out;
}

async function paginate(
  adminClient: any,
  query: string,
  pick: (data: any) => { edges?: any[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } | undefined,
  limit: number,
  onNode: (node: any) => void,
) {
  let after: string | null = null;
  let fetched = 0;
  for (;;) {
    const first = Math.min(PAGE_SIZE, limit - fetched);
    if (first <= 0) return;
    const res: any = await adminClient.request(query, { variables: { first, after } });
    const conn = pick(res?.data);
    const edges = conn?.edges || [];
    for (const e of edges) {
      onNode(e.node);
      fetched++;
    }
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) return;
    after = conn.pageInfo.endCursor;
  }
}

const SEO_METAFIELDS = `
  seoTitle: metafield(namespace: "global", key: "title_tag") { value }
  seoDescription: metafield(namespace: "global", key: "description_tag") { value }
`;

const COLLECTIONS_QUERY = `query($first: Int!, $after: String) {
  collections(first: $first, after: $after, sortKey: ID) {
    edges { node {
      id title handle descriptionHtml updatedAt
      productsCount { count }
      seo { title description }
      metafields(first: 20) { edges { node { namespace key value } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PAGES_QUERY = `query($first: Int!, $after: String) {
  pages(first: $first, after: $after, sortKey: ID) {
    edges { node {
      id title handle body isPublished updatedAt
      ${SEO_METAFIELDS}
      metafields(first: 20) { edges { node { namespace key value } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ARTICLES_QUERY = `query($first: Int!, $after: String) {
  articles(first: $first, after: $after, sortKey: ID) {
    edges { node {
      id title handle body isPublished updatedAt
      blog { handle }
      ${SEO_METAFIELDS}
      metafields(first: 20) { edges { node { namespace key value } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function fetchCatalogResources(adminClient: any, opts: { limit?: number } = {}): Promise<CatalogFetchResult> {
  const limit = opts.limit || DEFAULT_LIMIT;
  const resources: any[] = [];
  const counts: Record<CatalogResourceType, number> = { collection: 0, page: 0, article: 0 };
  const errors: CatalogFetchError[] = [];

  const run = async (resourceType: CatalogResourceType, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.warn(`[catalog] ${resourceType} fetch failed`, e);
      errors.push({ resourceType, message: describeShopifyError(e) });
    }
  };

  await run('collection', () =>
    paginate(adminClient, COLLECTIONS_QUERY, (d) => d?.collections, limit, (n) => {
      counts.collection++;
      resources.push({
        shopifyId: n.id, resourceType: 'collection', handle: n.handle, title: n.title,
        seoTitle: n.seo?.title || null, seoDescription: n.seo?.description || null,
        bodyHtml: n.descriptionHtml, metafields: metafieldRecord(n),
        productCount: n.productsCount?.count ?? 0,
        published: null,
        shopifyUpdatedAt: n.updatedAt,
      });
    }),
  );

  await run('page', () =>
    paginate(adminClient, PAGES_QUERY, (d) => d?.pages, limit, (n) => {
      counts.page++;
      resources.push({
        shopifyId: n.id, resourceType: 'page', handle: n.handle, title: n.title,
        seoTitle: n.seoTitle?.value || null, seoDescription: n.seoDescription?.value || null,
        bodyHtml: n.body, metafields: metafieldRecord(n),
        productCount: null,
        published: !!n.isPublished,
        shopifyUpdatedAt: n.updatedAt,
      });
    }),
  );

  await run('article', () =>
    paginate(adminClient, ARTICLES_QUERY, (d) => d?.articles, limit, (n) => {
      counts.article++;
      resources.push({
        shopifyId: n.id, resourceType: 'article', handle: n.handle, title: n.title,
        seoTitle: n.seoTitle?.value || null, seoDescription: n.seoDescription?.value || null,
        bodyHtml: n.body, metafields: metafieldRecord(n),
        productCount: null,
        published: !!n.isPublished,
        shopifyUpdatedAt: n.updatedAt,
        blogHandle: n.blog?.handle || null,
      });
    }),
  );

  return { resources, counts, errors };
}
