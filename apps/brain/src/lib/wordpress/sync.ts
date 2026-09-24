import {
  parseWordpressCatalogResourceType,
  siteCmsPlainError,
  wordpressCatalogResourceType,
  wordpressExternalCatalogId,
  wordpressSyncBlockedReason,
  type SiteCmsEntity,
} from '@cerevex/contracts';
import { createWordPressConnector } from '@cerevex/connector-wordpress';
import { upsertCatalogResource } from '../db/catalog';
import { getStore, updateStore } from '../db/stores';
import { logEvent } from '../brain/events';
import { wordpressFlagsFromStore } from './capabilities';
import {
  decryptWordpressPluginKey,
  isWordpressStore,
  wordpressConfigFromStore,
  wordpressSiteUrl,
} from './store';

export type WordpressSyncResult = {
  ok: boolean;
  synced: number;
  totalFetched: number;
  code?: string;
  reason?: string;
};

function catalogRowFromEntity(item: SiteCmsEntity) {
  return {
    shopifyId: wordpressExternalCatalogId(item.resourceType, item.externalId),
    resourceType: wordpressCatalogResourceType(item.resourceType),
    handle: item.handle,
    title: item.title,
    seoTitle: item.seoTitle || '',
    seoDescription: item.seoDescription || '',
    bodyHtml: item.bodyHtml,
    metafields: {
      connectorType: 'wordpress',
      externalId: item.externalId,
      resourceType: item.resourceType,
    },
    published: item.published ?? null,
    shopifyUpdatedAt: item.updatedAt || null,
    connectorType: 'wordpress',
    externalId: item.externalId,
  };
}

export async function syncWordpressForStore(storeId: string): Promise<WordpressSyncResult> {
  try {
    const store = await getStore(storeId);
    if (!store) {
      return { ok: false, synced: 0, totalFetched: 0, code: 'not_configured', reason: siteCmsPlainError('not_configured') };
    }
    const blocked = wordpressSyncBlockedReason(wordpressFlagsFromStore(store));
    if (blocked) {
      return { ok: false, synced: 0, totalFetched: 0, code: 'capability_off', reason: siteCmsPlainError('capability_off') };
    }
    if (!isWordpressStore(store)) {
      return { ok: false, synced: 0, totalFetched: 0, code: 'not_configured', reason: siteCmsPlainError('not_configured') };
    }
    const pluginKey = decryptWordpressPluginKey(store);
    const siteUrl = wordpressSiteUrl(store);
    const connector = createWordPressConnector({ siteUrl, pluginKey });
    const listed = await connector.listContent();
    if (!listed.ok) {
      return {
        ok: false,
        synced: 0,
        totalFetched: 0,
        code: listed.code,
        reason: listed.reason || siteCmsPlainError(listed.code),
      };
    }
    let synced = 0;
    for (const item of listed.items) {
      if (!parseWordpressCatalogResourceType(wordpressCatalogResourceType(item.resourceType))) continue;
      try {
        await upsertCatalogResource(storeId, catalogRowFromEntity(item));
        synced += 1;
      } catch (error) {
        console.warn('[wordpress.sync] upsert failed', item.externalId, error);
      }
    }
    const current = store.config || {};
    const wordpress = { ...wordpressConfigFromStore(store), lastSyncedAt: new Date().toISOString() };
    await updateStore(storeId, {
      name: store.name,
      shopify_domain: store.shopify_domain,
      shopify_access_token: '',
      platform: 'wordpress',
      connector_type: 'wordpress',
      config: { ...current, wordpress, catalogLastSynced: wordpress.lastSyncedAt, catalogSyncedCount: synced },
    });
    await logEvent(storeId, 'system', 'wordpress.synced', { synced, totalFetched: listed.items.length });
    return { ok: true, synced, totalFetched: listed.items.length };
  } catch (error) {
    console.warn('[wordpress.sync] degraded', error);
    return { ok: false, synced: 0, totalFetched: 0, code: 'plugin_down', reason: siteCmsPlainError('plugin_down') };
  }
}
