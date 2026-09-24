import { getActiveStoreId, getStore, updateStore } from '@/src/lib/db/stores';
import { loadGscSitesForStore } from '@/src/lib/gsc/client';
import {
  gscPropertyFallbackHelp,
  gscSitesEmptyCopy,
  gscSitesErrorCopy,
  mergeGscPropertyOptions,
} from '@/src/lib/gsc/sites';

async function saveGscPropertyAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const prop = String(formData.get('propertyUrl') || '').trim();
  const storeId = await getActiveStoreId();
  const store = storeId ? await getStore(storeId) : null;
  if (!store) {
    revalidatePath('/settings');
    redirect('/settings?gsc=error&message=' + encodeURIComponent('No active store'));
    return;
  }
  const config = { ...(store.config || {}), gsc: { ...(store.config?.gsc || {}), propertyUrl: prop } };
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config,
  });
  revalidatePath('/settings');
  redirect('/settings?gsc=property');
}

export async function GscPropertyField({
  connected,
  propertyUrl,
  storeId,
}: {
  connected: boolean;
  propertyUrl?: string;
  storeId?: string;
}) {
  if (!connected) {
    return <p className="cx-help">Connect Search Console to choose a property.</p>;
  }

  const { sites, error } = storeId
    ? await loadGscSitesForStore(storeId)
    : { sites: [], error: 'Could not load Search Console properties from Google.' };
  const options = mergeGscPropertyOptions(sites.map((site) => site.siteUrl), propertyUrl);
  const hasList = sites.length > 0;
  const showFallback = !hasList;
  const savedMissing = Boolean(propertyUrl && hasList && !sites.some((site) => site.siteUrl === propertyUrl));
  const selectValue = propertyUrl && options.includes(propertyUrl)
    ? propertyUrl
    : options.length === 1
      ? options[0]
      : '';

  return (
    <form action={saveGscPropertyAction} className="cx-form" style={{ marginTop: '1rem' }}>
      {error && <p className="cx-help">{gscSitesErrorCopy()}</p>}
      {!error && !hasList && <p className="cx-help">{gscSitesEmptyCopy()}</p>}
      {savedMissing && (
        <p className="cx-help">
          The saved property is not in this Google account&apos;s list. Pick a listed property, or reconnect.
        </p>
      )}
      {hasList && (
        <div className="cx-field">
          <label htmlFor="propertyUrl">Property</label>
          <select id="propertyUrl" name="propertyUrl" defaultValue={selectValue} required>
            <option value="" disabled>
              Select a Search Console property
            </option>
            {options.map((url) => (
              <option key={url} value={url}>{url}</option>
            ))}
          </select>
          <p className="cx-help">Properties from the connected Google account. Cerevex reads this property on Sync 28 days.</p>
        </div>
      )}
      {showFallback && (
        <div className="cx-field">
          <label htmlFor="propertyUrl">Property</label>
          <input
            id="propertyUrl"
            name="propertyUrl"
            defaultValue={propertyUrl || ''}
            placeholder="https://www.example.com/ or sc-domain:example.com"
          />
          <p className="cx-help">{gscPropertyFallbackHelp()}</p>
        </div>
      )}
      <button type="submit" className="btn-secondary">Save property</button>
    </form>
  );
}
