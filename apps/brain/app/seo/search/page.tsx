import Link from 'next/link';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { listGscRows } from '@/src/lib/db/gsc';
import { isGscConfigured } from '@/src/lib/gsc/client';
import { inngest } from '@/src/inngest/client';
import { revalidatePath } from 'next/cache';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';

async function syncGsc() {
  'use server';
  const storeId = await getActiveStoreId();
  if (storeId) {
    await inngest.send({ name: 'seo/gsc.sync.requested', data: { storeId } });
    revalidatePath('/seo/search');
  }
}

export const dynamic = 'force-dynamic';

export default async function SeoSearch() {
  const storeId = await getActiveStoreId();
  const store = storeId ? await getStore(storeId) : null;
  const gsc = store?.config?.gsc || {};
  let rows: any[] = [];
  try { if (storeId) rows = await listGscRows(storeId, 200); } catch {}
  const connected = !!gsc.refreshTokenEnc;
  const hostReady = isGscConfigured();

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Search Console"
        lede="Queries and pages from the last sync. Connect in Settings — this page does not start a new login."
        backHref="/seo"
        actions={
          <form action={syncGsc}>
            <button type="submit" className="btn-secondary" disabled={!connected}>
              Sync 28 days
            </button>
          </form>
        }
      />
      <SeoSubnav />

      <p className="cx-help" style={{ marginBottom: '1rem' }}>
        <StatusBadge
          label={connected ? 'Connected' : 'Not connected'}
          tone={connected ? 'trust' : 'warn'}
        />
        {gsc.propertyUrl ? ` · ${gsc.propertyUrl}` : ''}
        {gsc.lastSyncedAt ? ` · last sync ${new Date(gsc.lastSyncedAt).toLocaleString()}` : ''}
      </p>

      {!connected ? (
        <EmptyState
          message={
            hostReady
              ? 'Connect Search Console in Settings to see queries and clicks.'
              : 'Search Console is not connected. Open Settings to connect when the host is ready.'
          }
          actionHref="/settings#connects"
          actionLabel="Connect in Settings"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          message="No Search Console data yet. Sync the last 28 days to load queries."
          action={
            <form action={syncGsc}>
              <button type="submit" className="btn-cta">Sync 28 days</button>
            </form>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Query</th>
                <th>Page</th>
                <th>Clicks</th>
                <th>Impr</th>
                <th>CTR</th>
                <th>Pos</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i}>
                  <td data-label="Query">{r.query}</td>
                  <td data-label="Page">{r.page || '—'}</td>
                  <td data-label="Clicks">{r.clicks}</td>
                  <td data-label="Impr">{r.impressions}</td>
                  <td data-label="CTR">{(r.ctr * 100).toFixed(1)}%</td>
                  <td data-label="Pos">{r.position?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cx-help">
        Rows are from the last sync.{' '}
        <Link href="/settings#connects">Settings → Connects</Link>
      </p>
    </div>
  );
}
