import { inngest } from '../client';
import { recordCatalogSync, syncCatalogForStore, type CatalogSyncResult } from '@brain/lib/shopify/sync';
import { logEvent } from '@brain/lib/brain/events';
import { SHOPIFY_NOT_CONNECTED, SHOPIFY_NOT_CONNECTED_MESSAGE } from '@brain/lib/shopify/not-connected';

type CatalogSyncDeps = {
  syncCatalogForStore?: (storeId: string) => Promise<CatalogSyncResult>;
  recordCatalogSync?: typeof recordCatalogSync;
  logEvent?: typeof logEvent;
};

/** Runs one catalog sync. A store with no Shopify connection is reported and not retried. */
export async function runCatalogSync(storeId: string, deps: CatalogSyncDeps = {}): Promise<CatalogSyncResult> {
  const sync = deps.syncCatalogForStore ?? syncCatalogForStore;
  const record = deps.recordCatalogSync ?? recordCatalogSync;
  const recordEvent = deps.logEvent ?? logEvent;
  const result = await sync(storeId);
  if (result.skipped === SHOPIFY_NOT_CONNECTED) {
    try {
      await recordEvent(storeId, 'system', 'catalog.skipped', {
        skipped: result.skipped,
        message: result.message ?? SHOPIFY_NOT_CONNECTED_MESSAGE,
      });
    } catch {
      console.warn('[catalog-sync] skip was not recorded');
    }
    return result;
  }
  if (!result.skipped) await record(storeId, result);
  await recordEvent(storeId, 'system', 'catalog.synced', {
    synced: result.synced,
    counts: result.counts,
    errors: result.errors,
  });
  return result;
}

export const catalogSyncFn = inngest.createFunction(
  { id: 'seo-catalog-sync', retries: 1, triggers: [{ event: 'seo/catalog.sync.requested' }] },
  async ({ event, step }: any) => {
    const { storeId } = event.data;
    await step.run('sync-catalog', async () => runCatalogSync(storeId));
  }
);
