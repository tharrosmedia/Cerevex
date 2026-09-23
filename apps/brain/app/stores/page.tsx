import { listStores, createStore } from '@/src/lib/db/stores';
import { createAdminClient } from '@/src/lib/shopify/client';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { operatorLoadError } from '@/lib/ui-copy';

async function testConnection(formData: FormData) {
  'use server';
  const storeId = formData.get('storeId') as string;
  const { getStore } = await import('@/src/lib/db/stores');
  const store = await getStore(storeId);
  if (!store || !store.shopify_access_token) {
    redirect(`/stores?test=error&msg=${encodeURIComponent('No credentials')}`);
  }
  let shop: any;
  try {
    const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
    const query = `{
      shop {
        name
        id
      }
    }`;
    const response: any = await client.request(query);
    shop = response?.shop || response?.data?.shop || response;
    if (!shop || !shop.name) {
      throw new Error(`Unexpected Shopify response shape (check token/scopes/domain): ${JSON.stringify(response)}`);
    }
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) {
      throw e;
    }
    redirect(`/stores?test=error&msg=${encodeURIComponent(e.message || 'Connection failed')}`);
  }
  redirect(`/stores?test=success&msg=${encodeURIComponent(`Connected to ${shop.name} (${shop.id})`)}`);
}

async function addStore(formData: FormData) {
  'use server';
  const name = formData.get('name') as string;
  const shopify_domain = formData.get('shopify_domain') as string;
  const shopify_access_token = formData.get('shopify_access_token') as string;
  const platform = (formData.get('platform') as string) || 'shopify';
  let config: any = undefined;
  const configStr = formData.get('config') as string;
  if (configStr && configStr.trim()) {
    try { config = JSON.parse(configStr); } catch {}
  }
  if (!name || !shopify_domain || !shopify_access_token) {
    redirect(`/stores?add=error&msg=${encodeURIComponent('All fields required')}`);
  }
  const newStore = await createStore({ name, shopify_domain, shopify_access_token, platform, config });
  const cookieStore = await cookies();
  cookieStore.set('activeStoreId', newStore.id, {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  try {
    const { syncProductsForStore } = await import('@/src/lib/shopify/sync');
    await syncProductsForStore(newStore.id);
  } catch {}
  revalidatePath('/stores');
  redirect('/stores?add=success');
}

async function selectStore(formData: FormData) {
  'use server';
  const storeId = formData.get('storeId') as string;
  const cookieStore = await cookies();
  cookieStore.set('activeStoreId', storeId, {
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  redirect('/');
}

export default async function StoresPage({ searchParams }: { searchParams: Promise<{ test?: string; msg?: string; add?: string; updated?: string }> }) {
  const params = await searchParams;
  let stores: any[] = [];
  let loadError: string | null = null;
  try {
    stores = await listStores();
  } catch (e: any) {
    loadError = operatorLoadError(e.message) || 'Could not load stores.';
  }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Stores"
        title="Stores"
        lede="Add a Shopify store, test the connection, and choose the active store."
      />

      {loadError ? <p className="cx-banner cx-banner-warn" role="status">{loadError}</p> : null}
      {params.add === 'success' ? <p className="cx-banner" role="status">Store added.</p> : null}
      {params.add === 'error' ? <p className="cx-banner cx-banner-warn" role="status">Could not add store: {params.msg}</p> : null}
      {params.test === 'success' ? <p className="cx-banner" role="status">{params.msg}</p> : null}
      {params.test === 'error' ? <p className="cx-banner cx-banner-warn" role="status">Test failed: {params.msg}</p> : null}
      {params.updated === '1' ? <p className="cx-banner" role="status">Store updated.</p> : null}

      <section className="cx-panel">
        <h2>Add a store</h2>
        <form action={addStore} className="cx-form">
          <div className="cx-field">
            <label htmlFor="store-name">Store name</label>
            <input id="store-name" name="name" placeholder="My Store" required />
          </div>
          <div className="cx-field">
            <label htmlFor="store-platform">Platform</label>
            <select id="store-platform" name="platform" defaultValue="shopify">
              <option value="shopify">Shopify</option>
              <option value="woocommerce">WooCommerce</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="cx-field">
            <label htmlFor="store-domain">Shopify domain</label>
            <input id="store-domain" name="shopify_domain" placeholder="your-store.myshopify.com" required />
            <p className="cx-help">Exact format, e.g. hvacusa.myshopify.com — no https://, no trailing slash.</p>
          </div>
          <div className="cx-field">
            <label htmlFor="store-token">Shopify access token</label>
            <input id="store-token" name="shopify_access_token" placeholder="shpat_..." type="password" required />
            <p className="cx-help">Admin API token. Grant read_products + write_collections at minimum. After changing scopes, install the app again and paste the new token.</p>
          </div>
          <div className="cx-field">
            <label htmlFor="store-config">Config (JSON, optional)</label>
            <textarea id="store-config" name="config" placeholder='{"placement":{"collection":{"body":{"target":"main"}}}}' />
          </div>
          <button type="submit" className="btn-cta">Add store</button>
        </form>
      </section>

      <section>
        <h2>Your stores</h2>
        {stores.length === 0 ? (
          <EmptyState message="No stores yet. Add one above." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain</th>
                  <th>Platform</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store: any) => (
                  <tr key={store.id}>
                    <td data-label="Name">{store.name}</td>
                    <td data-label="Domain">{store.shopify_domain}</td>
                    <td data-label="Platform">
                      <StatusBadge label={store.platform || 'shopify'} tone="info" />
                    </td>
                    <td data-label="Created">{new Date(store.created_at).toLocaleDateString()}</td>
                    <td data-label="Actions">
                      <div className="cx-actions" style={{ marginTop: 0 }}>
                        <form action={testConnection}>
                          <input type="hidden" name="storeId" value={store.id} />
                          <button type="submit" className="btn-secondary">Test connection</button>
                        </form>
                        <form action={selectStore}>
                          <input type="hidden" name="storeId" value={store.id} />
                          <button type="submit" className="btn-cta">Select</button>
                        </form>
                        <Link href={`/stores/${store.id}/edit`} className="btn-secondary">Edit</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="cx-help">
          After adding, the new store is selected. Use the store switcher in the top right to change stores.
        </p>
      </section>
    </div>
  );
}
