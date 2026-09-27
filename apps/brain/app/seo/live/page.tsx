import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { listCatalogResources } from '@/src/lib/db/catalog';
import { catalogSyncSummary, recordCatalogSync, syncCatalogForStore } from '@/src/lib/shopify/sync';
import { revalidatePath } from 'next/cache';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { SubmitButton } from '@/components/submit-button';
import { operatorLoadError } from '@/lib/ui-copy';
import { formatWhen, resourceTypeLabel } from '@/lib/labels';
import { isWordpressStore, syncWordpressForStore } from '@/src/lib/wordpress';

const LIST_LIMIT = 200;

async function syncNow() {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) redirect('/seo/live?sync=no_store');
  const store = await getStore(storeId);
  if (store && isWordpressStore(store)) {
    const result = await syncWordpressForStore(storeId);
    revalidatePath('/seo/live');
    revalidatePath('/settings');
    if (!result.ok) {
      redirect(`/seo/live?sync=error&message=${encodeURIComponent(result.reason || 'WordPress sync failed.')}`);
    }
    redirect(`/seo/live?sync=wordpress&count=${result.synced}`);
  }
  try {
    const result = await syncCatalogForStore(storeId);
    await recordCatalogSync(storeId, result);
  } catch (e: any) {
    revalidatePath('/seo/live');
    redirect(`/seo/live?sync=error&message=${encodeURIComponent(e?.message || 'Catalog sync failed.')}`);
  }
  revalidatePath('/seo/live');
  revalidatePath('/settings');
  redirect('/seo/live?sync=done');
}

export const dynamic = 'force-dynamic';

export default async function SeoLive({
  searchParams,
}: {
  searchParams?: Promise<{ sync?: string; count?: string; message?: string }>;
}) {
  const params = (await (searchParams ?? Promise.resolve({}))) as { sync?: string; count?: string; message?: string };
  let resources: any[] = [];
  let store: any = null;
  let loadError: string | null = null;
  try {
    const storeId = await getActiveStoreId();
    if (storeId) {
      store = await getStore(storeId);
      resources = await listCatalogResources(storeId, LIST_LIMIT);
    }
  } catch (e: any) { loadError = operatorLoadError(e.message) || 'Could not load catalog.'; }

  const config = store?.config || {};
  const lastErrors: Array<{ resourceType: 'collection' | 'page' | 'article'; message: string }> = config.catalogSyncErrors || [];
  const status = [
    config.catalogSyncedCount != null ? `${config.catalogSyncedCount} items` : null,
    config.catalogLastSynced ? `last synced ${formatWhen(config.catalogLastSynced)}` : 'never synced',
  ].filter(Boolean).join(' · ');

  const syncForm = (primary: boolean) => (
    <form action={syncNow}>
      <SubmitButton className={primary ? 'btn-cta' : 'btn-secondary'} pendingLabel="Syncing…">Sync</SubmitButton>
    </form>
  );

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Live catalog"
        lede={`Collections, pages, and blog posts on your site. ${status.charAt(0).toUpperCase()}${status.slice(1)}.`}
        backHref="/seo"
        actions={syncForm(false)}
      />
      <SeoSubnav />

      {loadError ? <p className="cx-banner cx-banner-warn" role="status">Could not load catalog: {loadError}</p> : null}
      {params.sync === 'done' ? (
        <p className={`cx-banner${lastErrors.length ? ' cx-banner-warn' : ''}`} role="status">
          {catalogSyncSummary({
            counts: config.catalogSyncCounts || { collection: 0, page: 0, article: 0 },
            errors: lastErrors,
          })}
        </p>
      ) : null}
      {params.sync === 'wordpress' ? (
        <p className="cx-banner" role="status">Synced {params.count || '0'} WordPress posts and pages.</p>
      ) : null}
      {params.sync === 'error' ? (
        <p className="cx-banner cx-banner-warn" role="status">Sync failed: {params.message || 'try again.'}</p>
      ) : null}
      {params.sync === 'no_store' ? (
        <p className="cx-banner cx-banner-warn" role="status">Add a site first, then sync.</p>
      ) : null}
      {params.sync !== 'done' && lastErrors.length ? (
        <p className="cx-banner cx-banner-warn" role="status">
          The last sync was incomplete. {catalogSyncSummary({ counts: config.catalogSyncCounts || { collection: 0, page: 0, article: 0 }, errors: lastErrors })}
        </p>
      ) : null}

      {resources.length === 0 ? (
        <EmptyState
          message="Nothing synced yet. Sync to load your collections, pages, and blog posts."
          action={syncForm(true)}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Title</th>
                  <th>URL</th>
                  <th>SEO title</th>
                  <th>Products</th>
                  <th>Last updated</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r: any) => (
                  <tr key={r.id}>
                    <td data-label="Type">{resourceTypeLabel(r.resourceType)}</td>
                    <td data-label="Title">
                      <Link href={`/seo/live/${r.id}`}>{r.title || 'Untitled'}</Link>
                    </td>
                    <td data-label="URL">/{r.handle}</td>
                    <td data-label="SEO title">{r.seoTitle || 'Missing'}</td>
                    <td data-label="Products">{r.productCount ?? '—'}</td>
                    <td data-label="Last updated">{formatWhen(r.shopifyUpdatedAt || r.syncedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resources.length >= LIST_LIMIT ? (
            <p className="cx-help">Showing the first {LIST_LIMIT} items.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
