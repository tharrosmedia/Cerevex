import Link from 'next/link';
import { getActiveStoreId, getStore, updateStore } from '@/src/lib/db/stores';
import { listCatalogResources } from '@/src/lib/db/catalog';
import { syncCatalogForStore } from '@/src/lib/shopify/sync';
import { Button } from '@/components/ui/button';
import { revalidatePath } from 'next/cache';

async function syncNow() {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) return;
  const result = await syncCatalogForStore(storeId);
  const store = await getStore(storeId);
  if (store) {
    const current = store.config || {};
    await updateStore(storeId, {
      name: store.name, shopify_domain: store.shopify_domain, shopify_access_token: '',
      platform: store.platform || 'shopify',
      config: { ...current, catalogLastSynced: new Date().toISOString(), catalogSyncedCount: result.synced },
    });
  }
  revalidatePath('/seo/live');
  revalidatePath('/settings');
}

export const dynamic = 'force-dynamic';

export default async function SeoLive() {
  const storeId = await getActiveStoreId();
  let resources: any[] = [];
  let loadError: string | null = null;
  try {
    if (storeId) resources = await listCatalogResources(storeId, 200);
  } catch (e: any) { loadError = e.message || 'load failed'; }
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/seo" className="underline">← Overview</Link>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold mt-4">Live catalog</h1>
        <form action={syncNow}><Button type="submit" variant="outline">Sync now</Button></form>
      </div>
      {loadError && <div className="text-red-600">Error: {loadError}</div>}
      <table className="w-full border mt-4 text-sm">
        <thead>
          <tr className="bg-muted"><th className="p-2">Type</th><th>Title</th><th>Handle</th><th>SEO Title</th><th>Products</th><th>Synced</th></tr>
        </thead>
        <tbody>
          {resources.length === 0 && <tr><td colSpan={6} className="p-3 text-muted-foreground">No resources synced yet. Run sync from Settings or here.</td></tr>}
          {resources.map((r: any) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">{r.resourceType}</td>
              <td className="p-2">{r.title}</td>
              <td className="p-2 font-mono text-xs">/{r.handle}</td>
              <td className="p-2">{r.seoTitle || ''}</td>
              <td className="p-2">{r.productCount ?? ''}</td>
              <td className="p-2 text-xs">{r.syncedAt ? new Date(r.syncedAt).toLocaleDateString() : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Articles limited to first blog (v1).</p>
    </div>
  );
}
