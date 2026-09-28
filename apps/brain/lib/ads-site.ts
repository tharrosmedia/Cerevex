import { ADS_CONNECT_NO_CLIENT } from './ads-copy';
import { ensureSiteClient, type AdsClient } from './ads-bff';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';

export type SiteAds = {
  siteId: string | null;
  siteName: string | null;
  client: AdsClient | null;
  error: string | null;
};

/** The selected site and the ads client that owns its Meta/Google accounts. */
export async function resolveSiteAds(): Promise<SiteAds> {
  let siteId: string | null = null;
  let siteName: string | null = null;
  try {
    siteId = await getActiveStoreId();
    if (siteId) siteName = (await getStore(siteId))?.name ?? null;
  } catch {
    return { siteId: null, siteName: null, client: null, error: 'Could not load your sites.' };
  }
  if (!siteId) {
    return { siteId: null, siteName: null, client: null, error: ADS_CONNECT_NO_CLIENT };
  }
  const result = await ensureSiteClient(siteId, siteName || 'My site');
  if (!result.ok) return { siteId, siteName, client: null, error: result.message };
  return { siteId, siteName, client: result.data.client, error: null };
}
