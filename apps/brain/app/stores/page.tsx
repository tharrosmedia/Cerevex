import { listStores, createStore } from '@/src/lib/db/stores';
import { createAdminClient } from '@/src/lib/shopify/client';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

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
  // Initial product sync on store add (all products)
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
    loadError = e.message || 'Failed to load stores (check DATABASE_URL)';
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/" className="underline mb-4 block">← Back to Dashboard</Link>
      <h1 className="text-3xl font-bold mb-8">Store Management</h1>

      {loadError && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">Error: {loadError}</div>}
      {params.add === 'success' && <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Store added successfully.</div>}
      {params.add === 'error' && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">Add error: {params.msg}</div>}
      {params.test === 'success' && <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">{params.msg}</div>}
      {params.test === 'error' && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">Test failed: {params.msg}</div>}
      {params.updated === '1' && <div className="mb-4 p-3 bg-green-100 text-green-700 rounded text-sm">Store updated.</div>}

      <div className="mb-8 border p-4 rounded">
        <h2 className="font-semibold mb-4">Add New Store</h2>
        <form action={addStore} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Store Name</label>
            <input name="name" placeholder="My Store" className="border p-2 w-full" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Platform</label>
            <select name="platform" defaultValue="shopify" className="border p-2 w-full">
              <option value="shopify">Shopify</option>
              <option value="woocommerce">WooCommerce</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Shopify Domain</label>
            <input name="shopify_domain" placeholder="your-store.myshopify.com" className="border p-2 w-full" required />
            <p className="text-xs text-muted-foreground mt-1">Exact format, e.g. hvacusa.myshopify.com (no https://, no trailing slash)</p>
          </div>
           <div>
             <label className="block text-sm font-medium mb-1">Shopify Access Token</label>
             <input name="shopify_access_token" placeholder="shpat_..." type="password" className="border p-2 w-full" required />
              <p className="text-xs text-muted-foreground mt-1">Admin API token (starts with shpat_). Create at Shopify Admin → Settings → Apps and sales channels → Develop apps. Grant read_products + write_collections at minimum. After changing scopes, click "Install app" to generate a NEW access token and paste the updated one here.</p>
           </div>
           <div>
             <label className="block text-sm font-medium mb-1">Config (JSON, optional)</label>
             <textarea name="config" placeholder='{"placement":{"collection":{"body":{"target":"main"}}}}' className="border p-2 w-full h-24 font-mono text-sm" />
           </div>
           <Button type="submit">Add Store</Button>
        </form>
      </div>

      <h2 className="font-semibold mb-4">Your Stores</h2>
      {stores.length === 0 && !loadError && <p>No stores yet. Add one above.</p>}
      <table className="w-full border">
        <thead>
           <tr className="bg-muted">
             <th className="p-2 text-left">Name</th>
             <th className="p-2 text-left">Domain</th>
             <th className="p-2 text-left">Platform</th>
             <th className="p-2 text-left">Created</th>
             <th className="p-2">Actions</th>
           </tr>
        </thead>
        <tbody>
          {stores.map((store: any) => (
             <tr key={store.id} className="border-t">
               <td className="p-2">{store.name}</td>
               <td className="p-2">{store.shopify_domain}</td>
               <td className="p-2">{store.platform || 'shopify'}</td>
               <td className="p-2 text-sm">{new Date(store.created_at).toLocaleDateString()}</td>
               <td className="p-2 space-x-2">
                <form action={testConnection} className="inline">
                  <input type="hidden" name="storeId" value={store.id} />
                  <Button type="submit" variant="outline" size="sm">Test Connection</Button>
                </form>
                <form action={selectStore} className="inline">
                  <input type="hidden" name="storeId" value={store.id} />
                  <Button type="submit" size="sm">Select</Button>
                </form>
                <Link href={`/stores/${store.id}/edit`} className="underline text-sm">Edit</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4 text-sm text-muted-foreground">
        After adding, the new store is auto-selected. Use the header selector to switch stores. New stores will appear in the dashboard immediately.
      </p>
    </div>
  );
}
