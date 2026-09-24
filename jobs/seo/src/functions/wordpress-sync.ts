import { inngest } from '../client';
import { syncWordpressForStore } from '@brain/lib/wordpress/sync';

export const wordpressSyncFn = inngest.createFunction(
  { id: 'seo-wordpress-sync', retries: 1, triggers: [{ event: 'seo/wordpress.sync' }] },
  async ({ event, step }: any) => {
    const storeId = event.data?.storeId;
    return await step.run('sync-wordpress', async () => {
      if (!storeId) {
        return { ok: false, synced: 0, totalFetched: 0, code: 'invalid_payload', reason: 'Missing store.' };
      }
      return syncWordpressForStore(storeId);
    });
  }
);
