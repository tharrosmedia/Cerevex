import Link from 'next/link';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { listGscRows } from '@/src/lib/db/gsc';
import { isGscConfigured } from '@/src/lib/gsc/client';
import { inngest } from '@/src/inngest/client';
import { revalidatePath } from 'next/cache';
import { EmptyState } from '@/components/empty-state';
import { GscSearchRows } from '@/components/gsc-search-rows';
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
  let storeId: string | null = null;
  let store: any = null;
  let rows: any[] = [];
  try {
    storeId = await getActiveStoreId();
    store = storeId ? await getStore(storeId) : null;
    if (storeId) rows = await listGscRows(storeId, 200);
  } catch {}
  const gsc = store?.config?.gsc || {};
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
        <GscSearchRows rows={rows} />
      )}
      <p className="cx-help">
        Sorted by clicks, then impressions. Rows are from the last sync.{' '}
        <Link href="/settings#connects">Settings → Connects</Link>
      </p>
    </div>
  );
}
