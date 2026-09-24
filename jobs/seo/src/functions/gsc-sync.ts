import { inngest } from '../client';
import { fetchSearchAnalytics } from '@brain/lib/gsc/client';
import { upsertGscRows } from '@brain/lib/db/gsc';
import { getStore, updateStore } from '@brain/lib/db/stores';
import { logEvent } from '@brain/lib/brain/events';

export const gscSyncFn = inngest.createFunction(
  { id: 'seo-gsc-sync', retries: 1, triggers: [{ event: 'seo/gsc.sync.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data;
    await step.run('gsc-sync', async () => {
      const data = await fetchSearchAnalytics(storeId, 28);
      await upsertGscRows(storeId, data.rows);
      const store = await getStore(storeId);
      if (store) {
        const cfg = { ...(store.config || {}), gsc: { ...(store.config?.gsc || {}), lastSyncedAt: data.lastSynced } };
        await updateStore(storeId, { name: store.name, shopify_domain: store.shopify_domain, shopify_access_token: '', platform: store.platform || 'shopify', config: cfg });
      }
      await logEvent(storeId, 'system', 'gsc.synced', { count: data.rows.length });
      try {
        const { gscRecommendationsCanGenerate } = await import('@brain/lib/seo/gsc-flags');
        if (gscRecommendationsCanGenerate(store)) {
          await inngest.send({ name: 'seo/gsc.recommendations.requested', data: { storeId } });
        }
      } catch {}
      return { synced: data.rows.length };
    });
  }
);
