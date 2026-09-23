import { getActiveStoreId, getStore, updateStore } from '@/src/lib/db/stores';
import { listCatalogResources } from '@/src/lib/db/catalog';
import { syncCatalogForStore } from '@/src/lib/shopify/sync';
import { revalidatePath } from 'next/cache';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { operatorLoadError } from '@/lib/ui-copy';

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
  let storeId: string | null = null;
  let resources: any[] = [];
  let loadError: string | null = null;
  try {
    storeId = await getActiveStoreId();
    if (storeId) resources = await listCatalogResources(storeId, 200);
  } catch (e: any) { loadError = operatorLoadError(e.message) || 'Could not load catalog.'; }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Live catalog"
        lede="Collections, pages, and articles synced from the store."
        backHref="/seo"
        actions={
          <form action={syncNow}>
            <button type="submit" className="btn-secondary">Sync now</button>
          </form>
        }
      />
      <SeoSubnav />

      {loadError ? <p className="cx-banner cx-banner-warn" role="status">Could not load catalog: {loadError}</p> : null}

      {resources.length === 0 ? (
        <EmptyState
          message="No catalog pages synced yet. Sync now to load collections, pages, and articles."
          action={
            <form action={syncNow}>
              <button type="submit" className="btn-cta">Sync now</button>
            </form>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Handle</th>
                <th>SEO title</th>
                <th>Products</th>
                <th>Synced</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r: any) => (
                <tr key={r.id}>
                  <td data-label="Type">{r.resourceType}</td>
                  <td data-label="Title">{r.title}</td>
                  <td data-label="Handle">/{r.handle}</td>
                  <td data-label="SEO title">{r.seoTitle || '—'}</td>
                  <td data-label="Products">{r.productCount ?? '—'}</td>
                  <td data-label="Synced">{r.syncedAt ? new Date(r.syncedAt).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cx-help">Articles are limited to the first blog.</p>
    </div>
  );
}
