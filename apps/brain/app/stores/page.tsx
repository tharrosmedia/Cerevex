import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { listStores, createStore, getStore, getActiveStoreId } from '@/src/lib/db/stores';
import { inngest } from '@/src/inngest/client';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { SubmitButton } from '@/components/submit-button';
import { WordpressPluginDownload } from '@/components/wordpress-plugin-download';
import { operatorLoadError } from '@/lib/ui-copy';
import { formatWhen, platformLabel } from '@/lib/labels';
import {
  SHOPIFY_REQUIRED_SCOPES,
  normalizeShopDomain,
  verifyShopifyConnection,
} from '@/src/lib/shopify/verify';
import {
  connectWordpressStore,
  decryptWordpressPluginKey,
  isWordpressStore,
  testWordpressConnection,
  wordpressSiteUrl,
  wordpressWorkspaceSettingsFromStore,
} from '@/src/lib/wordpress';
import { isProductionRuntime } from '@/lib/runtime-env';

type Platform = 'shopify' | 'wordpress';

function storesUrl(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return `/stores${s ? `?${s}` : ''}`;
}

async function setActiveStore(storeId: string) {
  const jar = await cookies();
  jar.set('activeStoreId', storeId, {
    path: '/',
    secure: isProductionRuntime(),
    sameSite: 'lax',
  });
}

function scopeWarning(missing: string[]): string | undefined {
  if (!missing.length) return undefined;
  return `The token is missing ${missing.join(', ')}. Some syncing or publishing will fail until you add ${missing.length > 1 ? 'these permissions' : 'this permission'} and paste a new token.`;
}

async function addShopifyStore(formData: FormData) {
  'use server';
  const domain = normalizeShopDomain(String(formData.get('shopify_domain') || ''));
  const token = String(formData.get('shopify_access_token') || '').trim();
  const nameInput = String(formData.get('name') || '').trim();
  if (!domain) {
    redirect(storesUrl({ platform: 'shopify', add: 'error', msg: 'Enter your store address, like mystore.myshopify.com.' }));
  }
  if (!token) {
    redirect(storesUrl({ platform: 'shopify', add: 'error', msg: 'Paste the Admin API access token.' }));
  }
  const verified = await verifyShopifyConnection(domain, token);
  if (!verified.ok) {
    redirect(storesUrl({ platform: 'shopify', add: 'error', msg: `Could not connect: ${verified.error}` }));
  }
  const store = await createStore({
    name: nameInput || verified.shopName,
    shopify_domain: domain,
    shopify_access_token: token,
    platform: 'shopify',
    connector_type: 'shopify',
  });
  await setActiveStore(store.id);

  let warn = scopeWarning(verified.missingScopes);
  try {
    const { syncProductsForStore } = await import('@/src/lib/shopify/sync');
    await syncProductsForStore(store.id);
  } catch (e: any) {
    warn = [warn, `Products did not sync: ${e?.message || 'unknown error'}.`].filter(Boolean).join(' ');
  }
  try {
    await inngest.send({ name: 'seo/catalog.sync.requested', data: { storeId: store.id } });
  } catch (e) {
    console.warn('[stores] catalog sync enqueue failed', e);
  }
  revalidatePath('/stores');
  redirect(storesUrl({ add: 'success', name: store.name, warn }));
}

async function addWordpressSite(formData: FormData) {
  'use server';
  const activeId = await getActiveStoreId();
  const active = activeId ? await getStore(activeId) : null;
  const result = await connectWordpressStore({
    storeId: null,
    workspaceSettings: wordpressWorkspaceSettingsFromStore(active),
    name: String(formData.get('name') || ''),
    siteUrl: String(formData.get('siteUrl') || ''),
    pluginKey: String(formData.get('pluginKey') || ''),
  });
  if (!result.ok) {
    redirect(storesUrl({ platform: 'wordpress', add: 'error', msg: result.reason || 'Could not connect the site.' }));
  }
  revalidatePath('/stores');
  const created = result.storeId ? await getStore(result.storeId) : null;
  redirect(storesUrl({ add: 'success', name: created?.name }));
}

async function testConnection(formData: FormData) {
  'use server';
  const storeId = String(formData.get('storeId') || '');
  const store = await getStore(storeId);
  if (!store) redirect(storesUrl({ test: 'error', msg: 'That store no longer exists.' }));
  if (isWordpressStore(store)) {
    const tested = await testWordpressConnection({
      siteUrl: wordpressSiteUrl(store),
      pluginKey: decryptWordpressPluginKey(store),
    });
    redirect(tested.ok
      ? storesUrl({ test: 'success', msg: `${store.name} is connected.` })
      : storesUrl({ test: 'error', msg: `${store.name}: ${tested.reason || 'could not reach the site.'}` }));
  }
  if (!store.shopify_access_token) {
    redirect(storesUrl({ test: 'error', msg: `${store.name} has no access token. Edit the store and paste one.` }));
  }
  const verified = await verifyShopifyConnection(store.shopify_domain, store.shopify_access_token);
  if (!verified.ok) redirect(storesUrl({ test: 'error', msg: `${store.name}: ${verified.error}` }));
  redirect(storesUrl({
    test: 'success',
    msg: `Connected to ${verified.shopName}.`,
    warn: scopeWarning(verified.missingScopes),
  }));
}

async function selectStore(formData: FormData) {
  'use server';
  await setActiveStore(String(formData.get('storeId') || ''));
  redirect('/');
}

type SearchParams = {
  platform?: string;
  add?: string;
  name?: string;
  msg?: string;
  warn?: string;
  test?: string;
  updated?: string;
};

export const dynamic = 'force-dynamic';

export default async function StoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const platform: Platform | null = params.platform === 'shopify' || params.platform === 'wordpress' ? params.platform : null;
  let stores: any[] = [];
  let activeId: string | null = null;
  let loadError: string | null = null;
  try {
    stores = await listStores();
    activeId = await getActiveStoreId();
  } catch (e: any) {
    loadError = operatorLoadError(e.message) || 'Could not load stores.';
  }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Stores"
        title="Stores"
        lede="Your Shopify stores and WordPress sites. Switch between them from the header."
      />

      {loadError ? <p className="cx-banner cx-banner-warn" role="status">{loadError}</p> : null}
      {params.add === 'success' ? (
        <p className="cx-banner" role="status">
          {params.name ? `${params.name} added` : 'Added'} and selected. Its pages are syncing in the background.
        </p>
      ) : null}
      {params.test === 'success' ? <p className="cx-banner" role="status">{params.msg}</p> : null}
      {params.test === 'error' ? <p className="cx-banner cx-banner-warn" role="status">{params.msg}</p> : null}
      {params.warn ? <p className="cx-banner cx-banner-warn" role="status">{params.warn}</p> : null}
      {params.updated === '1' ? <p className="cx-banner" role="status">Store updated.</p> : null}

      {stores.length > 0 ? (
        <section className="cx-panel">
          <h2>Your stores</h2>
          <ul className="cx-site-list">
            {stores.map((store: any) => {
              const isActive = store.id === activeId;
              const wordpress = (store.connector_type || store.platform) === 'wordpress';
              return (
                <li key={store.id} className="cx-card cx-site-card">
                  <div className="cx-site-card-head">
                    <h3 className="cx-card-title">{store.name}</h3>
                    {isActive ? <StatusBadge label="Selected" tone="trust" /> : null}
                  </div>
                  <p className="cx-card-meta">
                    {platformLabel(wordpress ? 'wordpress' : 'shopify')} · <span className="cx-site-domain">{store.shopify_domain}</span>
                  </p>
                  <p className="cx-card-meta">
                    {store.config?.catalogLastSynced
                      ? `Pages synced ${formatWhen(store.config.catalogLastSynced)}`
                      : 'Pages not synced yet'}
                  </p>
                  <div className="cx-actions">
                    {!isActive ? (
                      <form action={selectStore}>
                        <input type="hidden" name="storeId" value={store.id} />
                        <button type="submit" className="btn-cta">Switch to this store</button>
                      </form>
                    ) : null}
                    <form action={testConnection}>
                      <input type="hidden" name="storeId" value={store.id} />
                      <SubmitButton className="btn-secondary" pendingLabel="Checking…">Check connection</SubmitButton>
                    </form>
                    <Link href={`/stores/${store.id}/edit`} className="btn-secondary">Edit</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="cx-panel" id="add">
        <h2>{stores.length ? 'Add another store or site' : 'Add your store or site'}</h2>
        <p className="cx-help">What kind of site is it?</p>
        <div className="cx-choice-grid" role="group" aria-label="Site type">
          <Link
            href={storesUrl({ platform: 'shopify' }) + '#add'}
            className={`cx-choice${platform === 'shopify' ? ' cx-choice-current' : ''}`}
            aria-current={platform === 'shopify' ? 'true' : undefined}
          >
            <strong>Shopify store</strong>
            <span>Connect with an Admin API access token.</span>
          </Link>
          <Link
            href={storesUrl({ platform: 'wordpress' }) + '#add'}
            className={`cx-choice${platform === 'wordpress' ? ' cx-choice-current' : ''}`}
            aria-current={platform === 'wordpress' ? 'true' : undefined}
          >
            <strong>WordPress site</strong>
            <span>Connect with the Cerevex plugin.</span>
          </Link>
        </div>

        {params.add === 'error' ? <p className="cx-banner cx-banner-warn" role="status">{params.msg}</p> : null}

        {platform === 'shopify' ? (
          <form action={addShopifyStore} className="cx-form">
            <div className="cx-field">
              <label htmlFor="store-domain">Store address</label>
              <input id="store-domain" name="shopify_domain" placeholder="mystore.myshopify.com" autoComplete="off" required />
              <p className="cx-help">Your .myshopify.com address. You can paste the full URL.</p>
            </div>
            <div className="cx-field">
              <label htmlFor="store-token">Admin API access token</label>
              <input id="store-token" name="shopify_access_token" placeholder="shpat_…" type="password" autoComplete="off" required />
              <details className="cx-details">
                <summary>How to create a token</summary>
                <ol className="cx-help cx-steps">
                  <li>In Shopify admin, open Settings → Apps and sales channels → Develop apps.</li>
                  <li>Create an app, then choose Configure Admin API scopes.</li>
                  <li>Turn on: {SHOPIFY_REQUIRED_SCOPES.join(', ')}.</li>
                  <li>Install the app and copy the Admin API access token.</li>
                </ol>
              </details>
            </div>
            <div className="cx-field">
              <label htmlFor="store-name">Name (optional)</label>
              <input id="store-name" name="name" placeholder="Uses your Shopify store name" />
            </div>
            <SubmitButton className="btn-cta" pendingLabel="Checking connection…">Connect store</SubmitButton>
          </form>
        ) : null}

        {platform === 'wordpress' ? (
          <form action={addWordpressSite} className="cx-form">
            <ol className="cx-help cx-steps">
              <li>
                Install the Cerevex plugin on your site.
                <WordpressPluginDownload
                  trailing={<a href="/api/wordpress/install-note">Install steps</a>}
                />
              </li>
              <li>In WordPress, open Settings → Cerevex and copy the plugin key.</li>
            </ol>
            <div className="cx-field">
              <label htmlFor="wp-url">Site address</label>
              <input id="wp-url" name="siteUrl" placeholder="https://example.com" required />
            </div>
            <div className="cx-field">
              <label htmlFor="wp-key">Plugin key</label>
              <input id="wp-key" name="pluginKey" type="password" autoComplete="off" required />
            </div>
            <div className="cx-field">
              <label htmlFor="wp-name">Name (optional)</label>
              <input id="wp-name" name="name" placeholder="Uses the site address" />
            </div>
            <SubmitButton className="btn-cta" pendingLabel="Checking connection…">Connect site</SubmitButton>
          </form>
        ) : null}
      </section>
    </div>
  );
}
