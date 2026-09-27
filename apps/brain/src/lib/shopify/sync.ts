import { getStore, updateStore } from '../db/stores';
import { createAdminClient } from './client';
import { fetchProducts } from './products';
import { upsertProduct } from '../db/products';
import { writeKnowledge } from '../brain/memory';
import { fetchCatalogResources, type CatalogFetchError, type CatalogResourceType } from './catalog';

export { catalogSyncSummary } from './catalog';
import { upsertCatalogResource } from '../db/catalog';

export async function syncProductsForStore(storeId: string) {
  const store = await getStore(storeId);
  if ((store?.connector_type || store?.platform) === 'wordpress') {
    return { synced: 0, totalFetched: 0, skipped: 'wordpress' as const };
  }
  if (!store || !store.shopify_access_token) {
    throw new Error('No Shopify credentials for store');
  }
  const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
  let prods: any[] = [];
  try {
    prods = await fetchProducts(client, { includeMetafields: true });
  } catch (e) {
    console.warn('Fetch with metafields failed, retrying without:', e);
    prods = await fetchProducts(client, { includeMetafields: false });
  }
  let count = 0;
  for (const p of prods) {
    try {
      await upsertProduct(storeId, p);
      count++;
      // Also write summary to knowledge for semantic retrieve
      try {
        await writeKnowledge(storeId, `Product: ${p.title} (/${p.handle}) - ${ (p.descriptionHtml || '').slice(0,200) }`, {
          type: 'shopify_product',
          handle: p.handle,
          shopifyId: p.shopifyId,
        });
      } catch {}
    } catch (e) {
      console.warn('Failed to upsert product', p.handle, e);
    }
  }
  return { synced: count, totalFetched: prods.length };
}

export type CatalogSyncResult = {
  synced: number;
  totalFetched: number;
  counts: Record<CatalogResourceType, number>;
  errors: CatalogFetchError[];
  skipped?: 'wordpress';
};

export async function syncCatalogForStore(storeId: string): Promise<CatalogSyncResult> {
  const store = await getStore(storeId);
  const emptyCounts = { collection: 0, page: 0, article: 0 };
  if ((store?.connector_type || store?.platform) === 'wordpress') {
    return { synced: 0, totalFetched: 0, counts: emptyCounts, errors: [], skipped: 'wordpress' };
  }
  if (!store || !store.shopify_access_token) {
    throw new Error('No Shopify credentials for store');
  }
  const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
  const { resources, counts, errors } = await fetchCatalogResources(client);
  let count = 0;
  for (const r of resources) {
    try {
      await upsertCatalogResource(storeId, r);
      count++;
    } catch (e) {
      console.warn('Failed to upsert catalog', r.handle, e);
    }
  }
  try { await writeKnowledge(storeId, `Catalog snapshot: ${count} resources synced`, { type: 'catalog_sync', count }); } catch {}
  return { synced: count, totalFetched: resources.length, counts, errors };
}

/** Saves the outcome of a catalog sync on the store so every page reports the same result. */
export async function recordCatalogSync(storeId: string, result: Pick<CatalogSyncResult, 'synced' | 'counts' | 'errors'>) {
  const store = await getStore(storeId);
  if (!store) return;
  await updateStore(storeId, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    connector_type: store.connector_type || store.platform || 'shopify',
    config: {
      ...(store.config || {}),
      catalogLastSynced: new Date().toISOString(),
      catalogSyncedCount: result.synced,
      catalogSyncCounts: result.counts,
      catalogSyncErrors: result.errors,
    },
  });
}
