import { getFirstBlog } from './blogs';

export async function fetchStoreSamples(adminClient: any, limit = 5) {
  const samples: Array<{ title: string; body: string }> = [];

  try {
    const shopQ = `query { shop { name description } }`;
    const shopRes = await adminClient.request(shopQ, {});
    const shop = shopRes?.data?.shop || shopRes?.shop;
    if (shop) {
      if (shop.name) samples.push({ title: 'Shop Name', body: shop.name });
      if (shop.description) samples.push({ title: 'Shop Description', body: shop.description });
    }
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    const prodQ = `
      query {
        products(first: ${limit}, sortKey: BEST_SELLING) {
          edges { node { title descriptionHtml productType } }
        }
      }
    `;
    const prodRes = await adminClient.request(prodQ, {});
    const prods = prodRes?.data?.products?.edges || [];
    prods.forEach((e: any) => {
      const n = e.node;
      if (n.title) samples.push({ title: n.title, body: (n.descriptionHtml || '').slice(0, 500) });
      if (n.productType) samples.push({ title: `${n.title} Type`, body: n.productType });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    const collQ = `
      query {
        collections(first: 3) {
          edges { node { title descriptionHtml } }
        }
      }
    `;
    const collRes = await adminClient.request(collQ, {});
    const colls = collRes?.data?.collections?.edges || [];
    colls.forEach((e: any) => {
      const n = e.node;
      if (n.title) samples.push({ title: n.title, body: (n.descriptionHtml || '').slice(0, 500) });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    const pageQ = `
      query {
        pages(first: 3) {
          edges { node { title body } }
        }
      }
    `;
    const pageRes = await adminClient.request(pageQ, {});
    const pages = pageRes?.data?.pages?.edges || [];
    pages.forEach((e: any) => {
      const n = e.node;
      if (n.title) samples.push({ title: n.title, body: (n.body || '').slice(0, 800) });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    const blog = await getFirstBlog(adminClient);
    const artQ = `
      query {
        blog(id: "${blog.id}") {
          articles(first: 3) {
            edges { node { title bodyHtml } }
          }
        }
      }
    `;
    const artRes = await adminClient.request(artQ, {});
    const arts = artRes?.data?.blog?.articles?.edges || [];
    arts.forEach((e: any) => {
      const n = e.node;
      if (n.title) samples.push({ title: n.title, body: (n.bodyHtml || '').slice(0, 500) });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  return samples.slice(0, 15);
}

export async function searchBrandContext(shopDomain: string, storeName?: string) {
  if (!process.env.TAVILY_API_KEY) return { results: [] };
  const query = storeName ? `${storeName} brand voice tone style site:${shopDomain}` : `${shopDomain} brand tone writing style`;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
      search_depth: 'basic',
    }),
  });
  return await res.json();
}

export async function fetchMetafieldDefinitions(adminClient: any) {
  const ownerTypes = ['COLLECTION', 'PAGE', 'ARTICLE', 'PRODUCT', 'SHOP'];
  const defs: any[] = [];
  for (const ot of ownerTypes) {
    try {
      const q = `
        query {
          metafieldDefinitions(first: 50, ownerType: ${ot}) {
            edges {
              node {
                namespace
                key
                name
                description
                type { name }
              }
            }
          }
        }
      `;
      const res = await adminClient.request(q, {});
      const edges = res?.data?.metafieldDefinitions?.edges || [];
      edges.forEach((e: any) => {
        defs.push({ ...e.node, ownerType: ot });
      });
    } catch (e) { console.warn('[shopify content] fetch failed:', e); }
  }
  return defs;
}

export async function fetchMetafieldValueSamples(adminClient: any) {
  const defs = await fetchMetafieldDefinitions(adminClient);
  const result: Record<string, { definitions: any[]; examples: any[] }> = {
    COLLECTION: { definitions: [], examples: [] },
    PRODUCT: { definitions: [], examples: [] },
    PAGE: { definitions: [], examples: [] },
    ARTICLE: { definitions: [], examples: [] },
    SHOP: { definitions: [], examples: [] },
  };

  // Attach definitions
  defs.forEach((d: any) => {
    if (result[d.ownerType]) result[d.ownerType].definitions.push(d);
  });

  // Sample actual values (limited to keep cheap)
  try {
    // Collections
    const collQ = `
      query {
        collections(first: 3) {
          edges {
            node {
              title
              metafields(first: 10) {
                edges { node { namespace key value type } }
              }
            }
          }
        }
      }
    `;
    const collRes = await adminClient.request(collQ, {});
    (collRes?.data?.collections?.edges || []).forEach((e: any) => {
      const mfs = (e.node.metafields?.edges || []).map((me: any) => me.node);
      if (mfs.length) result.COLLECTION.examples.push({ title: e.node.title, metafields: mfs });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    // Products
    const prodQ = `
      query {
        products(first: 3, sortKey: BEST_SELLING) {
          edges {
            node {
              title
              metafields(first: 10) {
                edges { node { namespace key value type } }
              }
            }
          }
        }
      }
    `;
    const prodRes = await adminClient.request(prodQ, {});
    (prodRes?.data?.products?.edges || []).forEach((e: any) => {
      const mfs = (e.node.metafields?.edges || []).map((me: any) => me.node);
      if (mfs.length) result.PRODUCT.examples.push({ title: e.node.title, metafields: mfs });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    // Shop level
    const shopQ = `
      query {
        shop {
          name
          metafields(first: 10) {
            edges { node { namespace key value type } }
          }
        }
      }
    `;
    const shopRes = await adminClient.request(shopQ, {});
    const shop = shopRes?.data?.shop || shopRes?.shop;
    if (shop?.metafields?.edges?.length) {
      const mfs = shop.metafields.edges.map((me: any) => me.node);
      result.SHOP.examples.push({ title: shop.name || 'Shop', metafields: mfs });
    }
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    // Pages
    const pageQ = `
      query {
        pages(first: 3) {
          edges {
            node {
              title
              metafields(first: 10) {
                edges { node { namespace key value type } }
              }
            }
          }
        }
      }
    `;
    const pageRes = await adminClient.request(pageQ, {});
    (pageRes?.data?.pages?.edges || []).forEach((e: any) => {
      const mfs = (e.node.metafields?.edges || []).map((me: any) => me.node);
      if (mfs.length) result.PAGE.examples.push({ title: e.node.title, metafields: mfs });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  try {
    // Articles (blog)
    const blog = await getFirstBlog(adminClient);
    const artQ = `
      query {
        blog(id: "${blog.id}") {
          articles(first: 3) {
            edges {
              node {
                title
                metafields(first: 10) {
                  edges { node { namespace key value type } }
                }
              }
            }
          }
        }
      }
    `;
    const artRes = await adminClient.request(artQ, {});
    (artRes?.data?.blog?.articles?.edges || []).forEach((e: any) => {
      const mfs = (e.node.metafields?.edges || []).map((me: any) => me.node);
      if (mfs.length) result.ARTICLE.examples.push({ title: e.node.title, metafields: mfs });
    });
  } catch (e) { console.warn('[shopify content] fetch failed:', e); }

  return result;
}
