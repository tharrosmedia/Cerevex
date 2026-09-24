import { listDrafts } from '@/src/lib/db/drafts';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { operatorLoadError } from '@/lib/ui-copy';

export const dynamic = 'force-dynamic';

export default async function Review({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const params = await searchParams;
  let storeId: string | null = null;
  let drafts: any[] = [];
  let loadError: string | null = null;
  try {
    storeId = await getActiveStoreId();
    const cookieStore = await cookies();
    if (!storeId) {
      const stores = await listStores();
      if (stores.length > 0) {
        storeId = stores[0].id;
        if (storeId) {
          cookieStore.set('activeStoreId', storeId, {
            path: '/',
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
          });
        }
      }
    }
    if (storeId) {
      drafts = await listDrafts(storeId, undefined, 20);
    }
  } catch (e: any) {
    loadError = operatorLoadError(e.message) || 'Could not load drafts.';
  }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="Review"
        title="Review"
        lede="Drafts waiting for a decision before they publish. WordPress writes wait for Approve too."
      />

      {params.success === 'decision-submitted' ? (
        <p className="cx-banner" role="status">
          Decision submitted. Approved Shopify and WordPress writes usually finish in under 30 seconds. Deny and Snooze never write.
        </p>
      ) : null}

      {loadError ? (
        <p className="cx-banner cx-banner-warn" role="status">Could not load drafts: {loadError}</p>
      ) : null}

      {drafts.length === 0 ? (
        <EmptyState
          message="No drafts to review for this store."
          actionHref="/seo/create"
          actionLabel="Create"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Handle</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d: any) => (
                <tr key={d.id}>
                  <td data-label="Title">{d.title}</td>
                  <td data-label="Type">{d.type}</td>
                  <td data-label="Handle">{d.handle || '—'}</td>
                  <td data-label="Created">{new Date(d.createdAt).toLocaleString()}</td>
                  <td data-label="Actions">
                    <Link href={`/drafts/${d.id}`} className="btn-secondary">View &amp; decide</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
