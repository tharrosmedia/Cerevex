import Link from 'next/link';
import {
  isWordpressApplyWritable,
  isWordpressConnectVisible,
  isWordpressConnectWritable,
  isWordpressSyncWritable,
  siteCmsPlainError,
} from '@cerevex/contracts';
import { getActiveStoreId, getStore, updateStore } from '@/src/lib/db/stores';
import {
  connectWordpressStore,
  disconnectWordpressStore,
  isWordpressStore,
  syncWordpressForStore,
  testWordpressConnection,
  wordpressApplyBlockedByKillSwitch,
  wordpressConfigFromStore,
  wordpressFlagsFromStore,
  wordpressWorkspaceSettingsFromStore,
} from '@/src/lib/wordpress';
import { StatusBadge } from '@/components/status-badge';

async function getActiveStore() {
  const storeId = await getActiveStoreId();
  if (!storeId) return null;
  return getStore(storeId);
}

function redirectSettings(query: string) {
  return `/settings?${query}`;
}

export async function WordpressConnectSettings() {
  let store = null;
  try {
    store = await getActiveStore();
  } catch {
    store = null;
  }
  const flags = wordpressFlagsFromStore(store);
  if (!isWordpressConnectVisible(flags)) return null;

  const writable = isWordpressConnectWritable(flags);
  const syncWritable = isWordpressSyncWritable(flags);
  const applyWritable = isWordpressApplyWritable(flags);
  const wp = wordpressConfigFromStore(store);
  const connected = isWordpressStore(store) && Boolean(wp.pluginKeyEnc || store?.shopify_access_token);
  const killOn = wordpressApplyBlockedByKillSwitch(store);

  return (
    <div className="cx-panel">
      <h2>WordPress</h2>
      {connected ? (
        <>
          <p className="cx-help">
            <StatusBadge label="Connected" tone="trust" />
            {wp.siteUrl ? ` · ${wp.siteUrl}` : ''}
            {wp.lastSyncedAt ? ` · last sync ${new Date(wp.lastSyncedAt).toLocaleString()}` : ''}
          </p>
          {killOn ? <p className="cx-help">WordPress writes are blocked for this store.</p> : null}
          {!applyWritable ? <p className="cx-help">Approve can save a draft. It will not write the site while WordPress apply is off.</p> : null}
          <div className="cx-actions">
            {syncWritable ? (
              <form action={syncWordpressAction}>
                <button type="submit" className="btn-secondary">Sync posts and pages</button>
              </form>
            ) : null}
            <Link href="/seo/live" className="btn-secondary">Open live catalog</Link>
            {writable ? (
              <form action={disconnectWordpressAction}>
                <button type="submit" className="btn-secondary">Disconnect</button>
              </form>
            ) : null}
          </div>
          {writable ? (
            <form action={saveWordpressKillSwitchAction} className="cx-form" style={{ marginTop: '1rem' }}>
              <label className="cx-field">
                <span>
                  <input type="checkbox" name="applyKillSwitch" defaultChecked={wp.applyKillSwitch !== false} /> Block WordPress writes
                </span>
                <p className="cx-help">When on, Approve still records a decision. Nothing is written to the site.</p>
              </label>
              <button type="submit" className="btn-secondary">Save write block</button>
            </form>
          ) : null}
        </>
      ) : (
        <>
          <p className="cx-help">
            WordPress sites can connect here when this module is on. Pilot client name and URL are still TBD — an HVAC-adjacent test site is fine.
          </p>
          {writable ? (
            <>
              <ol className="cx-help" style={{ paddingLeft: '1.2rem' }}>
                <li>
                  Install the Cerevex plugin.{' '}
                  <a href="/api/wordpress/plugin">Download zip</a>
                  {' · '}
                  <a href="/api/wordpress/install-note">Install note</a>
                </li>
                <li>Paste the site URL.</li>
                <li>Paste the plugin key from Settings → Cerevex in WordPress.</li>
                <li>Test connection. You should see Connected, or a plain error.</li>
              </ol>
              <form action={connectWordpressAction} className="cx-form">
                <div className="cx-field">
                  <label htmlFor="wp-name">Site name</label>
                  <input id="wp-name" name="name" placeholder="HVAC pilot (TBD)" />
                </div>
                <div className="cx-field">
                  <label htmlFor="wp-url">Site URL</label>
                  <input id="wp-url" name="siteUrl" placeholder="https://example.com" required />
                </div>
                <div className="cx-field">
                  <label htmlFor="wp-key">Plugin key</label>
                  <input id="wp-key" name="pluginKey" type="password" required />
                </div>
                <div className="cx-actions">
                  <button type="submit" name="intent" value="test" className="btn-secondary">Test connection</button>
                  <button type="submit" name="intent" value="connect" className="btn-cta">Connect WordPress</button>
                </div>
              </form>
            </>
          ) : (
            <p className="cx-help">WordPress connect is recommend-only. Nothing was written.</p>
          )}
        </>
      )}
    </div>
  );
}

async function connectWordpressAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const intent = String(formData.get('intent') || 'connect');
  const siteUrl = String(formData.get('siteUrl') || '');
  const pluginKey = String(formData.get('pluginKey') || '');
  const name = String(formData.get('name') || '');
  if (intent === 'test') {
    const tested = await testWordpressConnection({ siteUrl, pluginKey });
    revalidatePath('/settings');
    redirect(redirectSettings(tested.ok
      ? 'wordpress=tested'
      : `wordpress=error&message=${encodeURIComponent(tested.reason || siteCmsPlainError('unreachable'))}`));
  }
  const store = await getActiveStore();
  const result = await connectWordpressStore({
    storeId: store && isWordpressStore(store) ? store.id : null,
    workspaceSettings: wordpressWorkspaceSettingsFromStore(store),
    name,
    siteUrl,
    pluginKey,
  });
  revalidatePath('/settings');
  revalidatePath('/stores');
  redirect(redirectSettings(result.ok
    ? 'wordpress=connected'
    : `wordpress=error&message=${encodeURIComponent(result.reason || siteCmsPlainError('plugin_down'))}`));
}

async function disconnectWordpressAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store) {
    redirect(redirectSettings('wordpress=error&message=' + encodeURIComponent('No active store.')));
    return;
  }
  const result = await disconnectWordpressStore(store.id);
  revalidatePath('/settings');
  redirect(redirectSettings(result.ok
    ? 'wordpress=disconnected'
    : `wordpress=error&message=${encodeURIComponent(result.reason || "Couldn't disconnect WordPress.")}`));
}

async function syncWordpressAction() {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const { inngest } = await import('@/src/inngest/client');
  const store = await getActiveStore();
  if (!store) {
    redirect(redirectSettings('wordpress=error&message=' + encodeURIComponent('No active store.')));
    return;
  }
  try {
    await inngest.send({ name: 'seo/wordpress.sync', data: { storeId: store.id } });
  } catch {
    const result = await syncWordpressForStore(store.id);
    revalidatePath('/settings');
    revalidatePath('/seo/live');
    redirect(redirectSettings(result.ok
      ? `wordpress=synced&count=${result.synced}`
      : `wordpress=error&message=${encodeURIComponent(result.reason || siteCmsPlainError('plugin_down'))}`));
    return;
  }
  revalidatePath('/settings');
  redirect(redirectSettings('wordpress=syncing'));
}

async function saveWordpressKillSwitchAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const store = await getActiveStore();
  if (!store) {
    redirect(redirectSettings('wordpress=error&message=' + encodeURIComponent('No active store.')));
    return;
  }
  const applyKillSwitch = formData.get('applyKillSwitch') === 'on';
  const current = store.config || {};
  await updateStore(store.id, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: 'wordpress',
    connector_type: 'wordpress',
    config: { ...current, wordpress: { ...wordpressConfigFromStore(store), applyKillSwitch } },
  });
  revalidatePath('/settings');
  redirect(redirectSettings('wordpress=kill'));
}
