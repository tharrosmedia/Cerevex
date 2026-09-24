import Link from 'next/link';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { listGscRows, summarizeGscRows } from '@/src/lib/db/gsc';
import { isGscConfigured } from '@/src/lib/gsc/client';
import { inngest } from '@/src/inngest/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { Flash } from '@/components/settings-nav';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';
import { SubmitButton } from '@/components/submit-button';
import { gscRecommendationsAreVisible } from '@/src/lib/seo/gsc-flags';
import {
  GSC_RECS_NO_STORE_COPY,
  GSC_RECS_TURN_ON_CTA,
  GSC_SYNC_QUEUED_COPY,
  GSC_SYNC_RECS_OFF_COPY,
} from '@/src/lib/seo/gsc-copy';

async function syncGsc() {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) {
    redirect('/seo/search?sync=no_store');
  }
  const store = await getStore(storeId);
  await inngest.send({ name: 'seo/gsc.sync.requested', data: { storeId } });
  revalidatePath('/seo/search');
  if (!gscRecommendationsAreVisible(store)) {
    redirect('/seo/search?sync=recs_off');
  }
  redirect('/seo/search?sync=queued');
}

export const dynamic = 'force-dynamic';

export default async function SeoSearch({ searchParams }: { searchParams?: Promise<{ sync?: string }> }) {
  const params = await (searchParams || Promise.resolve({})) as { sync?: string };
  let storeId: string | null = null;
  let store: any = null;
  let rows: any[] = [];
  let summary: any = { rows: 0, queries: 0, pages: 0, impressions: 0, clicks: 0 };
  let recsOn = false;
  try {
    storeId = await getActiveStoreId();
    store = storeId ? await getStore(storeId) : null;
    if (storeId) {
      rows = await listGscRows(storeId, 200);
      summary = await summarizeGscRows(storeId);
    }
    recsOn = gscRecommendationsAreVisible(store);
  } catch {}
  const gsc = store?.config?.gsc || {};
  const connected = !!gsc.refreshTokenEnc;
  const hostReady = isGscConfigured();

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Search Console"
        lede="Connect and sync Search Console here. Recommendations live on Recommendations — this page does not write the site."
        backHref="/seo"
        actions={
          <form action={syncGsc}>
            <SubmitButton className="btn-secondary" disabled={!connected} pendingLabel="Syncing…">
              Sync 28 days
            </SubmitButton>
          </form>
        }
      />
      <SeoSubnav />

      {params.sync === 'queued' && <Flash>{GSC_SYNC_QUEUED_COPY}</Flash>}
      {params.sync === 'no_store' && <Flash tone="warn">{GSC_RECS_NO_STORE_COPY}</Flash>}
      {params.sync === 'recs_off' && (
        <Flash>
          <p style={{ margin: 0 }}>{GSC_SYNC_RECS_OFF_COPY}</p>
          <div className="cx-actions" style={{ marginTop: '0.75rem' }}>
            <Link href="/settings#capabilities" className="btn-cta">{GSC_RECS_TURN_ON_CTA}</Link>
          </div>
        </Flash>
      )}

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
              ? 'Connect Search Console in Settings to see a short summary.'
              : 'Search Console is not connected. Open Settings to connect when the host is ready.'
          }
          actionHref="/settings#connects"
          actionLabel="Connect in Settings"
        />
      ) : (
        <section className="cx-panel">
          <h2>Summary</h2>
          <ul className="cx-status-list">
            <li><span>Searches</span><span>{summary.queries || 0}</span></li>
            <li><span>Pages</span><span>{summary.pages || 0}</span></li>
            <li><span>Impressions</span><span>{summary.impressions || 0}</span></li>
            <li><span>Clicks</span><span>{summary.clicks || 0}</span></li>
          </ul>
          <p className="cx-help">
            {recsOn
              ? 'Use Recommendations for what to change. Tables stay collapsed here.'
              : 'Search recommendations are off. Connect and sync still work. Turn the flag on in Settings to generate cards — this page does not flip it.'}
          </p>
          <div className="cx-actions">
            {recsOn ? <Link href="/seo/findings" className="btn-cta">Open recommendations</Link> : (
              <Link href="/settings#capabilities" className="btn-cta">{GSC_RECS_TURN_ON_CTA}</Link>
            )}
            <Link href="/settings#connects" className="btn-secondary">Settings → Connects</Link>
          </div>
        </section>
      )}

      {connected && rows.length === 0 ? (
        <EmptyState
          message="No Search Console data yet. Sync the last 28 days to load queries."
          action={
            <form action={syncGsc}>
              <SubmitButton className="btn-cta" pendingLabel="Syncing…">Sync 28 days</SubmitButton>
            </form>
          }
        />
      ) : null}

      {connected && rows.length > 0 ? (
        <details className="cx-details cx-panel">
          <summary>Query and page table</summary>
          <p className="cx-help">Raw sync rows. Do not treat this table as the product — recommendations are the next step.</p>
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
        </details>
      ) : null}
    </div>
  );
}
