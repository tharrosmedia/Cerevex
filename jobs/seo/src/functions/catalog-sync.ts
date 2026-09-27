import { inngest } from '../client';
import { recordCatalogSync, syncCatalogForStore } from '@brain/lib/shopify/sync';
import { logEvent } from '@brain/lib/brain/events';

export const catalogSyncFn = inngest.createFunction(
  { id: 'seo-catalog-sync', retries: 1, triggers: [{ event: 'seo/catalog.sync.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data;
    await step.run('sync-catalog', async () => {
      const result = await syncCatalogForStore(storeId);
      if (!result.skipped) await recordCatalogSync(storeId, result);
      await logEvent(storeId, 'system', 'catalog.synced', { synced: result.synced, counts: result.counts, errors: result.errors });
      return result;
    });
  }
);
