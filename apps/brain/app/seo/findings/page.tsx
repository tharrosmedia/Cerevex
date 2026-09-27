import Link from 'next/link';
import { getActiveStoreId, getStore, updateStore } from '@/src/lib/db/stores';
import { listOpenFindings, setFindingStatus } from '@/src/lib/db/findings';
import { createJob, updateJobStatus } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import { revalidatePath } from 'next/cache';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { GscCatalogFindingCard, GscRecommendationCard } from '@/components/gsc-recommendation-card';
import { Flash } from '@/components/settings-nav';
import { SubmitButton } from '@/components/submit-button';
import {
  GSC_KILL_SWITCH_HELP,
  GSC_POSITION_EDUCATION,
  GSC_REC_TYPE_LABELS,
  GSC_RECOMMEND_ONLY_COPY,
  GSC_RECS_FLAG_OFF_COPY,
  GSC_RECS_NO_STORE_COPY,
  GSC_RECS_QUEUED_COPY,
  GSC_RECS_TURN_ON_CTA,
  GSC_THRESHOLD_HELP,
} from '@/src/lib/seo/gsc-copy';
import { gscApplyIsWritable, gscRecommendationsAreVisible, gscRecommendationsCanGenerate } from '@/src/lib/seo/gsc-flags';
import { isGscRecKind } from '@/src/lib/seo/gsc-recommendations';
import { parsePositionThreshold, positionThresholdFromStore, withGscStoreConfig } from '@/src/lib/seo/gsc-threshold';
import { logEvent } from '@/src/lib/brain/events';
import { redirect } from 'next/navigation';

async function dismissFinding(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const status = (formData.get('status') as string) === 'snoozed' ? 'snoozed' : 'denied';
  const storeId = await getActiveStoreId();
  await setFindingStatus(id, status);
  if (storeId) await logEvent(storeId, 'human', `gsc.finding.${status}`, { findingId: id, writes: false });
  revalidatePath('/seo/findings');
}

async function startFromFinding(formData: FormData) {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) redirect('/seo/findings?recs=no_store');
  const id = formData.get('id') as string;
  const shopifyId = formData.get('shopifyId') as string || undefined;
  const handle = formData.get('handle') as string;
  const resourceType = (formData.get('resourceType') as string) || 'page';
  const topQuery = formData.get('query') as string || '';
  const title = formData.get('title') as string || topQuery;
  const recType = formData.get('recType') as string || '';
  const mode = recType === 'gsc_n' ? 'create' : 'improve';
  const type = recType === 'gsc_n' ? 'page' : (resourceType === 'article' || resourceType === 'wp_post' ? 'blog' : resourceType === 'collection' ? 'collection' : 'page');

  const detailStr = formData.get('detail') as string || '{}';
  let detail: any = {};
  try { detail = JSON.parse(detailStr); } catch {}
  const queries = Array.isArray(detail.queries) ? detail.queries : (topQuery ? [topQuery] : []);
  const liveSnapshot = {
    title: title || handle,
    bodyHtml: '',
    metaTitle: title || '',
    metaDescription: '',
    metafields: {},
    selectedProducts: [],
    shopifyId,
  };

  const job = await createJob({
    storeId,
    domain: 'seo',
    type,
    input: {
      keyword: topQuery || title,
      mode,
      shopifyId,
      handle,
      liveSnapshot,
      gscQueries: queries,
      source: recType ? 'gsc' : undefined,
      gscRecType: recType || undefined,
    },
    status: 'queued',
  });
  try {
    await inngest.send({
      name: 'seo/job.requested',
      data: {
        storeId,
        keyword: topQuery || title,
        type,
        jobId: job.id,
        mode,
        shopifyId,
        handle,
        liveSnapshot,
        gscQueries: queries,
        source: recType ? 'gsc' : undefined,
        gscRecType: recType || undefined,
      },
    });
  } catch (e: any) {
    console.error('[findings] draft enqueue failed', e);
    await updateJobStatus(job.id, 'failed', { reason: e?.message || 'enqueue failed' });
    redirect('/seo/findings?draft=error');
  }
  await setFindingStatus(id, 'queued');
  await logEvent(storeId, 'human', 'gsc.draft.queued', { findingId: id, jobId: job.id, recType, writes: false });
  revalidatePath('/seo/findings');
  revalidatePath('/review');
  revalidatePath('/');
  redirect(`/seo/findings?draft=queued&title=${encodeURIComponent(title || topQuery || 'this page')}`);
}

async function runRecommendations() {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) {
    redirect('/seo/findings?recs=no_store');
  }
  const store = await getStore(storeId);
  if (!gscRecommendationsCanGenerate(store)) {
    redirect('/seo/findings?recs=flag_off');
  }
  await inngest.send({ name: 'seo/gsc.recommendations.requested', data: { storeId } });
  await logEvent(storeId, 'human', 'gsc.recommendations.requested', { writes: false });
  revalidatePath('/seo/findings');
  redirect('/seo/findings?recs=queued');
}

async function runAudit() {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) redirect('/seo/findings?recs=no_store');
  try {
    await inngest.send({ name: 'seo/audit.requested', data: { storeId } });
  } catch (e) {
    console.error('[findings] catalog check enqueue failed', e);
    redirect('/seo/findings?audit=error');
  }
  revalidatePath('/seo/findings');
  redirect('/seo/findings?audit=queued');
}

async function saveThreshold(formData: FormData) {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) return;
  const store = await getStore(storeId);
  if (!store) return;
  const threshold = parsePositionThreshold(formData.get('positionThreshold'));
  const next = withGscStoreConfig(store.config || {}, { positionThreshold: threshold });
  await updateStore(storeId, {
    name: store.name,
    shopify_domain: store.shopify_domain,
    shopify_access_token: '',
    platform: store.platform || 'shopify',
    config: next,
  });
  if (gscRecommendationsCanGenerate(store)) {
    await inngest.send({ name: 'seo/gsc.recommendations.requested', data: { storeId } });
  }
  revalidatePath('/seo/findings');
  revalidatePath('/settings');
}

export const dynamic = 'force-dynamic';

type FindingsParams = { type?: string; recs?: string; draft?: string; title?: string; audit?: string };

export default async function SeoFindings({ searchParams }: { searchParams?: Promise<FindingsParams> }) {
  const params = await (searchParams || Promise.resolve({})) as FindingsParams;
  let findings: any[] = [];
  let store: any = null;
  let recsOn = false;
  let applyWritable = false;
  let threshold = 3;
  try {
    const storeId = await getActiveStoreId();
    store = storeId ? await getStore(storeId) : null;
    recsOn = gscRecommendationsAreVisible(store);
    applyWritable = gscApplyIsWritable(store);
    threshold = positionThresholdFromStore(store);
    if (storeId) findings = await listOpenFindings(storeId, 100);
  } catch {}

  const gscFindings = findings.filter((f) => isGscRecKind(f.kind));
  const otherFindings = findings.filter((f) => !isGscRecKind(f.kind));
  const typeFilter = params.type && isGscRecKind(params.type) ? params.type : '';
  const visibleGsc = typeFilter ? gscFindings.filter((f) => f.kind === typeFilter) : gscFindings;

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Recommendations"
        lede="Pages worth improving, based on your Search Console data and a check of your pages."
        backHref="/seo"
        actions={
          <div className="cx-actions" style={{ marginTop: 0 }}>
            {recsOn ? (
              <form action={runRecommendations}>
                <SubmitButton className="btn-cta" pendingLabel="Refreshing…">Refresh recommendations</SubmitButton>
              </form>
            ) : null}
            <form action={runAudit}>
              <SubmitButton className="btn-secondary" pendingLabel="Starting…">Check pages</SubmitButton>
            </form>
          </div>
        }
      />
      <SeoSubnav />

      {params.draft === 'queued' ? (
        <Flash>
          <p style={{ margin: 0 }}>
            Drafting a fix for “{params.title || 'this page'}”. It will appear in Review when it&apos;s ready, usually within a few minutes.
          </p>
          <div className="cx-actions" style={{ marginTop: '0.75rem' }}>
            <Link href="/review" className="btn-cta">Open Review</Link>
          </div>
        </Flash>
      ) : null}
      {params.draft === 'error' ? (
        <Flash tone="warn">Could not start the draft. Nothing changed. Try again in a moment.</Flash>
      ) : null}
      {params.audit === 'queued' ? (
        <Flash>Checking your pages. New recommendations will appear here when the check finishes.</Flash>
      ) : null}
      {params.audit === 'error' ? (
        <Flash tone="warn">Could not start the page check. Try again in a moment.</Flash>
      ) : null}

      {params.recs === 'queued' && <Flash>{GSC_RECS_QUEUED_COPY}</Flash>}
      {params.recs === 'no_store' && <Flash tone="warn">{GSC_RECS_NO_STORE_COPY}</Flash>}
      {params.recs === 'flag_off' && (
        <Flash tone="warn">
          <p style={{ margin: 0 }}>{GSC_RECS_FLAG_OFF_COPY}</p>
          <div className="cx-actions" style={{ marginTop: '0.75rem' }}>
            <Link href="/settings#capabilities" className="btn-cta">{GSC_RECS_TURN_ON_CTA}</Link>
          </div>
        </Flash>
      )}

      {recsOn ? (
        <section className="cx-panel">
          <h2>Place cutoff</h2>
          <p className="cx-help">{GSC_THRESHOLD_HELP}</p>
          <form action={saveThreshold} className="cx-filters">
            <label>
              Show “Update this page” when average place is worse than
              <input
                type="number"
                name="positionThreshold"
                min={1}
                max={20}
                step={0.1}
                defaultValue={threshold}
              />
            </label>
            <button type="submit" className="btn-secondary">Save cutoff</button>
          </form>
          <p className="cx-help">{GSC_POSITION_EDUCATION}</p>
          {!applyWritable ? <p className="cx-help">{GSC_RECOMMEND_ONLY_COPY}</p> : (
            <p className="cx-help">{GSC_KILL_SWITCH_HELP}</p>
          )}
          <p className="cx-help">
            Filter:{' '}
            <Link href="/seo/findings">All</Link>
            {Object.entries(GSC_REC_TYPE_LABELS).map(([id, label]) => (
              <span key={id}>
                {' · '}
                <Link href={`/seo/findings?type=${id}`}>{label}</Link>
              </span>
            ))}
          </p>
        </section>
      ) : (
        <p className="cx-help">
          Search recommendations are turned off. You can still connect and sync{' '}
          <Link href="/seo/search">Search Console</Link>. To get recommendations, turn them on in{' '}
          <Link href="/settings#capabilities">Settings</Link>.
        </p>
      )}

      {recsOn && visibleGsc.length === 0 ? (
        <EmptyState
          message="No Search recommendations yet. Sync Search Console, then refresh recommendations."
          action={
            <div className="cx-actions">
              <form action={runRecommendations}>
                <SubmitButton className="btn-cta" pendingLabel="Refreshing…">Refresh recommendations</SubmitButton>
              </form>
              <Link href="/seo/search" className="btn-secondary">Open Search Console</Link>
            </div>
          }
        />
      ) : null}

      {recsOn && visibleGsc.length > 0 ? (
        <div className="cx-card-grid" style={{ gridTemplateColumns: '1fr' }}>
          {visibleGsc.map((f: any) => (
            <GscRecommendationCard
              key={f.id}
              finding={f}
              applyWritable={applyWritable}
              actions={
                <>
                  <form action={startFromFinding}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="shopifyId" value={f.shopifyId || ''} />
                    <input type="hidden" name="handle" value={f.handle || ''} />
                    <input type="hidden" name="resourceType" value={f.resourceType || ''} />
                    <input type="hidden" name="query" value={f.detail?.query || f.detail?.queries?.[0] || ''} />
                    <input type="hidden" name="title" value={f.title || ''} />
                    <input type="hidden" name="recType" value={f.kind || ''} />
                    <input type="hidden" name="detail" value={JSON.stringify(f.detail || {})} />
                    <SubmitButton className="btn-cta" pendingLabel="Starting…">
                      {f.kind === 'gsc_n' ? 'Draft a new page' : 'Draft a fix'}
                    </SubmitButton>
                  </form>
                  <form action={dismissFinding}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="status" value="snoozed" />
                    <SubmitButton className="btn-secondary" pendingLabel="Snoozing…">Snooze</SubmitButton>
                  </form>
                  <form action={dismissFinding}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="status" value="denied" />
                    <SubmitButton className="btn-secondary" pendingLabel="Dismissing…">Dismiss</SubmitButton>
                  </form>
                </>
              }
            />
          ))}
        </div>
      ) : null}

      {otherFindings.length === 0 && (!recsOn || visibleGsc.length === 0) && !recsOn ? (
        <EmptyState
          message="No recommendations yet. Sync your live catalog and Search Console, then check your pages."
          action={
            <form action={runAudit}>
              <SubmitButton className="btn-cta" pendingLabel="Starting…">Check pages</SubmitButton>
            </form>
          }
        />
      ) : null}

      {otherFindings.length > 0 ? (
        <section>
          <h2>Catalog checks</h2>
          <div className="cx-card-grid" style={{ gridTemplateColumns: '1fr' }}>
            {otherFindings.map((f: any) => (
              <GscCatalogFindingCard
                key={f.id}
                finding={f}
                actions={
                  <>
                    <form action={startFromFinding}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="shopifyId" value={f.shopifyId || ''} />
                      <input type="hidden" name="handle" value={f.handle || ''} />
                      <input type="hidden" name="resourceType" value={f.resourceType || ''} />
                      <input type="hidden" name="query" value={f.detail?.query || ''} />
                      <input type="hidden" name="title" value={f.title || ''} />
                      <input type="hidden" name="detail" value={JSON.stringify(f.detail || {})} />
                      <SubmitButton className="btn-secondary" pendingLabel="Starting…">Draft a fix</SubmitButton>
                    </form>
                    <form action={dismissFinding}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="status" value="denied" />
                      <SubmitButton className="btn-secondary" pendingLabel="Dismissing…">Dismiss</SubmitButton>
                    </form>
                  </>
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
