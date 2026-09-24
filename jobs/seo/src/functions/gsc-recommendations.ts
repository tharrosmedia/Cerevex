import { inngest } from '../client';
import { getStore } from '@brain/lib/db/stores';
import { listCatalogResources } from '@brain/lib/db/catalog';
import { listGscRows } from '@brain/lib/db/gsc';
import { replaceOpenGscRecommendations } from '@brain/lib/db/findings';
import { logEvent } from '@brain/lib/brain/events';
import { generateGscRecommendations } from '@brain/lib/seo/gsc-recommendations';
import { gscRecommendationsCanGenerate, gscFlagsFromStore } from '@brain/lib/seo/gsc-flags';
import { positionThresholdFromStore, withGscStoreConfig } from '@brain/lib/seo/gsc-threshold';
import { updateStore } from '@brain/lib/db/stores';
import { isGscRecommendationsVisible } from '@cerevex/contracts';

export const gscRecommendationsFn = inngest.createFunction(
  { id: 'seo-gsc-recommendations', retries: 1, triggers: [{ event: 'seo/gsc.recommendations.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data || {};
    return await step.run('gsc-to-recommendations', async () => {
      if (!storeId) return { generated: 0, reason: 'missing_store' };
      const store = await getStore(storeId);
      if (!store) return { generated: 0, reason: 'missing_store' };
      if (!gscRecommendationsCanGenerate(store)) {
        await logEvent(storeId, 'system', 'gsc.recommendations.skipped', { reason: 'flag_off' });
        return { generated: 0, reason: 'flag_off' };
      }
      const flags = gscFlagsFromStore(store);
      if (!isGscRecommendationsVisible(flags) && flags['seo.gsc.recommendations'] !== 'on') {
        return { generated: 0, reason: 'flag_off' };
      }
      const rows = await listGscRows(storeId, 4000);
      const catalog = await listCatalogResources(storeId, 2000);
      const threshold = positionThresholdFromStore(store);
      const recs = generateGscRecommendations({
        rows,
        catalog,
        positionThreshold: threshold,
      });
      await replaceOpenGscRecommendations(storeId, recs);
      const cfg = withGscStoreConfig(store.config || {}, { lastRecommendationsAt: new Date().toISOString() });
      await updateStore(storeId, {
        name: store.name,
        shopify_domain: store.shopify_domain,
        shopify_access_token: '',
        platform: store.platform || 'shopify',
        config: cfg,
      });
      await logEvent(storeId, 'system', 'gsc.recommendations.generated', {
        count: recs.length,
        types: recs.reduce((acc: Record<string, number>, rec) => {
          acc[rec.recType] = (acc[rec.recType] || 0) + 1;
          return acc;
        }, {}),
        threshold,
      });
      return { generated: recs.length, threshold };
    });
  },
);
