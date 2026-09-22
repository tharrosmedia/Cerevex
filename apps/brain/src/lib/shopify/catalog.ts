import { createAdminClient } from './client';
import { getFirstBlog } from './blogs';

export async function fetchCatalogResources(adminClient: any, opts: { limit?: number } = {}) {
  const resources: any[] = [];
  const { limit } = opts;

  // Collections
  try {
    let hasNext = true; let cursor: string | null = null;
    while (hasNext && (!limit || resources.length < (limit||1000))) {
      const first = Math.min(50, (limit||1000) - resources.length);
      const q = `query($first:Int!, $after:String) {
        collections(first:$first, after:$after, sortKey:ID) {
          edges { node {
            id title handle descriptionHtml
            productsCount { count }
            seo { title description }
            updatedAt
            publishedOnCurrentPublication
            metafields(first:20) { edges { node { namespace key value type } } }
          } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`;
      const res: any = await adminClient.request(q, { variables: { first, after: cursor } });
      const edges = res?.data?.collections?.edges || [];
      for (const e of edges) {
        const n = e.node;
        const mfs: any = {};
        (n.metafields?.edges || []).forEach((me: any) => { mfs[`${me.node.namespace}.${me.node.key}`] = me.node.value; });
        resources.push({
          shopifyId: n.id, resourceType: 'collection', handle: n.handle, title: n.title,
          seoTitle: n.seo?.title || null, seoDescription: n.seo?.description || null,
          bodyHtml: n.descriptionHtml, metafields: mfs,
          productCount: n.productsCount?.count || 0,
          published: !!n.publishedOnCurrentPublication,
          shopifyUpdatedAt: n.updatedAt,
        });
      }
      const pi: any = res?.data?.collections?.pageInfo; hasNext = pi?.hasNextPage; cursor = pi?.endCursor || null;
      if (limit && resources.length >= limit) break;
    }
  } catch (e) { console.warn('[catalog] collections fetch failed', e); }

  // Pages
  try {
    let hasNext = true; let cursor: string | null = null;
    while (hasNext && (!limit || resources.length < (limit||1000))) {
      const first = Math.min(50, (limit||1000) - resources.length);
      const q = `query($first:Int!, $after:String) {
        pages(first:$first, after:$after, sortKey:ID) {
          edges { node {
            id title handle body
            seo { title description }
            updatedAt
            publishedOnCurrentPublication
            metafields(first:20) { edges { node { namespace key value type } } }
          } cursor }
          pageInfo { hasNextPage endCursor }
        }
      }`;
      const res: any = await adminClient.request(q, { variables: { first, after: cursor } });
      const edges = res?.data?.pages?.edges || [];
      for (const e of edges) {
        const n = e.node;
        const mfs: any = {};
        (n.metafields?.edges || []).forEach((me: any) => { mfs[`${me.node.namespace}.${me.node.key}`] = me.node.value; });
        resources.push({
          shopifyId: n.id, resourceType: 'page', handle: n.handle, title: n.title,
          seoTitle: n.seo?.title || null, seoDescription: n.seo?.description || null,
          bodyHtml: n.body, metafields: mfs,
          productCount: null,
          published: !!n.publishedOnCurrentPublication,
          shopifyUpdatedAt: n.updatedAt,
        });
      }
      const pi: any = res?.data?.pages?.pageInfo; hasNext = pi?.hasNextPage; cursor = pi?.endCursor || null;
      if (limit && resources.length >= limit) break;
    }
  } catch (e) { console.warn('[catalog] pages fetch failed', e); }

  // Articles (first blog only - documented limitation for v1)
  try {
    const blog = await getFirstBlog(adminClient);
    let hasNext = true; let cursor: string | null = null;
    while (hasNext && (!limit || resources.length < (limit||1000))) {
      const first = Math.min(50, (limit||1000) - resources.length);
      const q = `query($first:Int!, $after:String, $blogId:ID!) {
        blog(id:$blogId) {
          articles(first:$first, after:$after, sortKey:ID) {
            edges { node {
              id title handle bodyHtml
              seo { title description }
              updatedAt
              publishedAt
              metafields(first:20) { edges { node { namespace key value type } } }
            } cursor }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`;
      const res: any = await adminClient.request(q, { variables: { first, after: cursor, blogId: blog.id } });
      const edges = res?.data?.blog?.articles?.edges || [];
      for (const e of edges) {
        const n = e.node;
        const mfs: any = {};
        (n.metafields?.edges || []).forEach((me: any) => { mfs[`${me.node.namespace}.${me.node.key}`] = me.node.value; });
        resources.push({
          shopifyId: n.id, resourceType: 'article', handle: n.handle, title: n.title,
          seoTitle: n.seo?.title || null, seoDescription: n.seo?.description || null,
          bodyHtml: n.bodyHtml, metafields: mfs,
          productCount: null,
          published: !!n.publishedAt,
          shopifyUpdatedAt: n.updatedAt,
        });
      }
      const pi: any = res?.data?.blog?.articles?.pageInfo; hasNext = pi?.hasNextPage; cursor = pi?.endCursor || null;
      if (limit && resources.length >= limit) break;
    }
  } catch (e) { console.warn('[catalog] articles fetch failed (first blog only)', e); }

  return resources;
}
