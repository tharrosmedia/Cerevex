import { inngest } from '../client';
import { syncCatalogForStore } from '@brain/lib/shopify/sync';
import { logEvent } from '@brain/lib/brain/events';
import { updateStore, getStore } from '@brain/lib/db/stores';

export const catalogSyncFn = inngest.createFunction(
  { id: 'seo-catalog-sync', retries: 1, triggers: [{ event: 'seo/catalog.sync.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data;
    await step.run('sync-catalog', async () => {
      const result = await syncCatalogForStore(storeId);
      const store = await getStore(storeId);
      if (store) {
        const current = store.config || {};
        await updateStore(storeId, {
          name: store.name,
          shopify_domain: store.shopify_domain,
          shopify_access_token: '',
          platform: store.platform || 'shopify',
          config: { ...current, catalogLastSynced: new Date().toISOString(), catalogSyncedCount: result.synced },
        });
      }
      await logEvent(storeId, 'system', 'catalog.synced', { synced: result.synced });
      return result;
    });
  }
);
