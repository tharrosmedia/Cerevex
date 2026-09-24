import Link from 'next/link';
import { getActiveStoreId, getStore, updateStore } from '@/src/lib/db/stores';
import { listOpenFindings, setFindingStatus } from '@/src/lib/db/findings';
import { createJob } from '@/src/lib/db/jobs';
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
  if (!storeId) return;
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
  await setFindingStatus(id, 'queued');
  await logEvent(storeId, 'human', 'gsc.draft.queued', { findingId: id, jobId: job.id, recType, writes: false });
  revalidatePath('/seo/findings');
  revalidatePath('/review');
  revalidatePath('/');
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
  if (storeId) {
    await inngest.send({ name: 'seo/audit.requested', data: { storeId } });
    revalidatePath('/seo/findings');
  }
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

export default async function SeoFindings({ searchParams }: { searchParams?: Promise<{ type?: string; recs?: string }> }) {
  const params = await (searchParams || Promise.resolve({})) as { type?: string; recs?: string };
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
        lede="Conversion-first Search recommendations. Rank without a better offer does not stick."
        backHref="/seo"
        actions={
          <div className="cx-actions" style={{ marginTop: 0 }}>
            {recsOn ? (
              <form action={runRecommendations}>
                <SubmitButton className="btn-cta" pendingLabel="Refreshing…">Refresh recommendations</SubmitButton>
              </form>
            ) : null}
            <form action={runAudit}>
              <button type="submit" className="btn-secondary">Run catalog check</button>
            </form>
          </div>
        }
      />
      <SeoSubnav />

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
          Search recommendations are off for this workspace. Connect and Sync still work on{' '}
          <Link href="/seo/search">Search Console</Link>. Turn the flag on in{' '}
          <Link href="/settings#capabilities">Settings → Capability flags</Link>
          {' '}to generate cards — this page does not flip it.
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
                    <button type="submit" className="btn-cta">
                      {f.kind === 'gsc_n' ? 'Create' : 'Review'}
                    </button>
                  </form>
                  <form action={dismissFinding}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="status" value="snoozed" />
                    <button type="submit" className="btn-secondary">Snooze</button>
                  </form>
                  <form action={dismissFinding}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="status" value="denied" />
                    <button type="submit" className="btn-secondary">Deny</button>
                  </form>
                </>
              }
            />
          ))}
        </div>
      ) : null}

      {otherFindings.length === 0 && (!recsOn || visibleGsc.length === 0) && !recsOn ? (
        <EmptyState
          message="No open findings. Run a catalog check after catalog and Search Console sync."
          action={
            <form action={runAudit}>
              <button type="submit" className="btn-cta">Run catalog check</button>
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
                      <button type="submit" className="btn-secondary">Review</button>
                    </form>
                    <form action={dismissFinding}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="status" value="denied" />
                      <button type="submit" className="btn-secondary">Dismiss</button>
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
