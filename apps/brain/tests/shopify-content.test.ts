import assert from 'node:assert/strict';
import { catalogSyncSummary, describeShopifyError, fetchCatalogResources } from '../src/lib/shopify/catalog';
import { createAndPublishPage, updatePage } from '../src/lib/shopify/pages';
import { createAndPublishArticle, updateArticle } from '../src/lib/shopify/blogs';
import { seoMetafields } from '../src/lib/shopify/seo-metafields';
import { SHOPIFY_REQUIRED_SCOPES, missingShopifyScopes, normalizeShopDomain, verifyShopifyClient } from '../src/lib/shopify/verify';

type Call = { query: string; variables: any };

function fakeClient(handler: (query: string, variables: any) => any) {
  const calls: Call[] = [];
  return {
    calls,
    async request(query: string, opts: { variables?: any } = {}) {
      calls.push({ query, variables: opts.variables });
      return handler(query, opts.variables);
    },
  };
}

function connection(key: string, nodes: any[]) {
  return { data: { [key]: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } } };
}

const accessDenied = Object.assign(new Error('GraphQL Client: An error occurred while fetching from the API. Review graphQLErrors for details.'), {
  body: {
    errors: {
      graphQLErrors: [
        {
          message: 'Access denied for articles field. Required access: `read_content` access scope.',
          extensions: { code: 'ACCESS_DENIED', requiredAccess: '`read_content` access scope.' },
        },
      ],
    },
  },
});

// Catalog: fields that don't exist on Page/Article, or need extra scopes, must not be requested.
{
  const client = fakeClient((query) => {
    if (query.includes('collections(')) {
      return connection('collections', [
        { id: 'gid://shopify/Collection/1', title: 'Filters', handle: 'filters', descriptionHtml: '<p>x</p>', updatedAt: '2026-09-01T00:00:00Z', productsCount: { count: 4 }, seo: { title: 'Filters', description: null }, metafields: { edges: [] } },
      ]);
    }
    if (query.includes('pages(')) {
      return connection('pages', [
        { id: 'gid://shopify/Page/1', title: 'About', handle: 'about', body: '<p>hi</p>', isPublished: true, updatedAt: '2026-09-02T00:00:00Z', seoTitle: { value: 'About us' }, seoDescription: null, metafields: { edges: [] } },
      ]);
    }
    if (query.includes('articles(')) throw accessDenied;
    throw new Error('unexpected query');
  });
  const result = await fetchCatalogResources(client);

  for (const call of client.calls) {
    assert.ok(!call.query.includes('publishedOnCurrentPublication'), 'must not need read_product_listings');
    assert.ok(!call.query.includes('bodyHtml'), 'Article/Page expose body, not bodyHtml');
  }
  const pagesQuery = client.calls.find((c) => c.query.includes('pages('))!.query;
  assert.ok(!/\bseo\s*\{/.test(pagesQuery), 'Page has no seo field');
  assert.ok(pagesQuery.includes('key: "title_tag"'));
  const articlesQuery = client.calls.find((c) => c.query.includes('articles('))!.query;
  assert.ok(!articlesQuery.includes('blog(id:'), 'articles come from every blog, not just the first');

  assert.deepEqual(result.counts, { collection: 1, page: 1, article: 0 });
  assert.equal(result.resources.length, 2);
  assert.equal(result.resources.find((r) => r.resourceType === 'page').seoTitle, 'About us');
  assert.equal(result.resources.find((r) => r.resourceType === 'page').published, true);
  assert.deepEqual(result.errors, [
    { resourceType: 'article', message: 'The Shopify token is missing the read_content permission.' },
  ]);
  assert.equal(
    catalogSyncSummary(result),
    'Synced 1 collections and 1 pages. Blog posts failed: The Shopify token is missing the read_content permission.',
  );
}

// Catalog: pagination follows endCursor.
{
  let page = 0;
  const client = fakeClient((query, variables) => {
    if (!query.includes('collections(')) return connection(query.includes('pages(') ? 'pages' : 'articles', []);
    page++;
    return {
      data: {
        collections: {
          edges: [{ node: { id: `gid://shopify/Collection/${page}`, title: `C${page}`, handle: `c${page}`, metafields: { edges: [] } } }],
          pageInfo: page === 1 ? { hasNextPage: true, endCursor: 'cursor-1' } : { hasNextPage: false, endCursor: null },
        },
      },
    };
  });
  const result = await fetchCatalogResources(client);
  assert.equal(result.counts.collection, 2);
  assert.equal(client.calls.filter((c) => c.query.includes('collections('))[1].variables.after, 'cursor-1');
}

assert.equal(describeShopifyError(new Error('[API] Invalid API key or access token (unrecognized login or wrong password)')), 'Shopify rejected the access token. Replace it in Settings → Sites.');
assert.equal(catalogSyncSummary({ counts: { collection: 0, page: 0, article: 0 }, errors: [] }), 'Synced 0 collections, 0 pages and 0 blog posts.');

// SEO title/description go through global metafields for pages and articles.
assert.deepEqual(seoMetafields('  Title ', ''), [{ namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: 'Title' }]);
assert.deepEqual(seoMetafields(null, undefined), []);

{
  const client = fakeClient(() => ({ data: { pageCreate: { page: { id: 'gid://shopify/Page/9', handle: 'x' }, userErrors: [] } } }));
  await createAndPublishPage(client, { title: 'X', handle: 'x', bodyHtml: '<p>x</p>', seoTitle: 'SEO X', seoDescription: 'Desc' });
  assert.equal(client.calls.length, 1, 'pages publish via isPublished, not publishablePublish');
  assert.ok(client.calls[0].query.includes('pageCreate(page: $page)'));
  assert.ok(client.calls[0].query.includes('PageCreateInput!'));
  const page = client.calls[0].variables.page;
  assert.equal(page.body, '<p>x</p>');
  assert.equal(page.isPublished, true);
  assert.equal(page.seo, undefined);
  assert.deepEqual(page.metafields.map((m: any) => m.key), ['title_tag', 'description_tag']);
}

{
  const client = fakeClient(() => ({ data: { pageUpdate: { page: { id: 'gid://shopify/Page/9' }, userErrors: [] } } }));
  await updatePage(client, 'gid://shopify/Page/9', { title: 'X', bodyHtml: '', seoTitle: 'SEO X' });
  assert.ok(client.calls[0].query.includes('pageUpdate(id: $id, page: $page)'));
  assert.equal(client.calls[0].variables.page.body, undefined, 'empty body must not wipe the live page');
}

{
  const client = fakeClient((query) => {
    if (query.includes('blogs(')) return { data: { blogs: { edges: [{ node: { id: 'gid://shopify/Blog/1', handle: 'news' } }] } } };
    return { data: { articleCreate: { article: { id: 'gid://shopify/Article/5', handle: 'post' }, userErrors: [] } } };
  });
  await createAndPublishArticle(client, { title: 'Post', bodyHtml: '<p>b</p>', seoDescription: 'D', authorName: 'My Store' });
  const create = client.calls.find((c) => c.query.includes('articleCreate'))!;
  assert.ok(create.query.includes('articleCreate(article: $article)'));
  assert.ok(create.query.includes('ArticleCreateInput!'));
  const article = create.variables.article;
  assert.equal(article.blogId, 'gid://shopify/Blog/1');
  assert.equal(article.body, '<p>b</p>');
  assert.equal(article.bodyHtml, undefined);
  assert.deepEqual(article.author, { name: 'My Store' });
  assert.equal(article.isPublished, true);
  assert.deepEqual(article.metafields.map((m: any) => m.key), ['description_tag']);
  assert.equal(client.calls.some((c) => c.query.includes('publishablePublish')), false);
}

{
  const client = fakeClient(() => ({ data: { articleUpdate: { article: { id: 'a' }, userErrors: [{ field: ['title'], message: 'Title is too long' }] } } }));
  await assert.rejects(() => updateArticle(client, 'a', { title: 'x'.repeat(300) }), /Title is too long/);
  assert.ok(client.calls[0].query.includes('ArticleUpdateInput!'));
}

// Store address normalization and permission checks for Add store.
assert.equal(normalizeShopDomain('mystore'), 'mystore.myshopify.com');
assert.equal(normalizeShopDomain(' https://MyStore.myshopify.com/admin/products '), 'mystore.myshopify.com');
assert.equal(normalizeShopDomain('admin.shopify.com/store/my-store'), 'my-store.myshopify.com');
assert.equal(normalizeShopDomain('www.example.com'), null);
assert.equal(normalizeShopDomain(''), null);
assert.deepEqual(
  missingShopifyScopes(['write_products', 'read_content', 'read_publications', 'write_publications']),
  ['write_content'],
);
{
  const ok = await verifyShopifyClient(fakeClient(() => ({
    data: { shop: { name: 'Got Ductless' }, currentAppInstallation: { accessScopes: SHOPIFY_REQUIRED_SCOPES.map((handle) => ({ handle })) } },
  })));
  assert.deepEqual(ok, { ok: true, shopName: 'Got Ductless', missingScopes: [] });
  const bad = await verifyShopifyClient(fakeClient(() => { throw new Error('[API] Invalid API key or access token (unrecognized login or wrong password)'); }));
  assert.deepEqual(bad, { ok: false, error: 'Shopify rejected the access token. Replace it in Settings → Sites.' });
}

console.log('shopify-content: ok');
