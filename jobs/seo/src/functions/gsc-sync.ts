import { inngest } from '../client';
import { fetchSearchAnalytics } from '@brain/lib/gsc/client';
import { upsertGscRows } from '@brain/lib/db/gsc';
import { getStore, updateStore } from '@brain/lib/db/stores';
import { logEvent } from '@brain/lib/brain/events';
import { gscRecommendationsCanGenerate } from '@brain/lib/seo/gsc-flags';

export const gscSyncFn = inngest.createFunction(
  { id: 'seo-gsc-sync', retries: 1, triggers: [{ event: 'seo/gsc.sync.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data;
    const result = await step.run('gsc-sync', async () => {
      const data = await fetchSearchAnalytics(storeId, 28);
      await upsertGscRows(storeId, data.rows);
      const store = await getStore(storeId);
      if (store) {
        const cfg = { ...(store.config || {}), gsc: { ...(store.config?.gsc || {}), lastSyncedAt: data.lastSynced } };
        await updateStore(storeId, { name: store.name, shopify_domain: store.shopify_domain, shopify_access_token: '', platform: store.platform || 'shopify', config: cfg });
      }
      await logEvent(storeId, 'system', 'gsc.synced', { count: data.rows.length });
      return { synced: data.rows.length, canGenerate: gscRecommendationsCanGenerate(store) };
    });

    if (!result.canGenerate) {
      await step.run('gsc-recommendations-skip', async () => {
        await logEvent(storeId, 'system', 'gsc.recommendations.skipped', { reason: 'flag_off', source: 'gsc-sync' });
      });
      return { ...result, emitted: false, reason: 'flag_off' };
    }

    try {
      await step.sendEvent('gsc-recommendations-requested', {
        name: 'seo/gsc.recommendations.requested',
        data: { storeId },
      });
    } catch (err: any) {
      await step.run('gsc-recommendations-emit-failed', async () => {
        await logEvent(storeId, 'system', 'gsc.recommendations.emit_failed', {
          reason: err?.message || 'send_failed',
          source: 'gsc-sync',
        });
      });
      throw err;
    }

    await step.run('gsc-recommendations-requested-log', async () => {
      await logEvent(storeId, 'system', 'gsc.recommendations.requested', { source: 'gsc-sync', writes: false });
    });
    return { ...result, emitted: true };
  }
);
