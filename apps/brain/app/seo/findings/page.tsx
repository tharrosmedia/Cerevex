import Link from 'next/link';
import { getActiveStoreId } from '@/src/lib/db/stores';
import { listOpenFindings, setFindingStatus } from '@/src/lib/db/findings';
import { createJob } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import { revalidatePath } from 'next/cache';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';
import type { StatusTone } from '@/lib/job-labels';

async function dismissFinding(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  await setFindingStatus(id, 'dismissed');
  revalidatePath('/seo/findings');
}

async function improveFromFinding(formData: FormData) {
  'use server';
  const storeId = await getActiveStoreId();
  if (!storeId) return;
  const id = formData.get('id') as string;
  const shopifyId = formData.get('shopifyId') as string || undefined;
  const handle = formData.get('handle') as string;
  const resourceType = (formData.get('resourceType') as string) || 'collection';
  const topQuery = formData.get('query') as string || '';
  const title = formData.get('title') as string || topQuery;

  const detailStr = formData.get('detail') as string || '{}';
  let detail: any = {};
  try { detail = JSON.parse(detailStr); } catch {}
  const liveSnapshot = {
    title: title || handle,
    bodyHtml: '',
    metaTitle: title || '',
    metaDescription: '',
    metafields: {},
    selectedProducts: [],
  };

  const job = await createJob({ storeId, domain: 'seo', type: resourceType, input: { keyword: topQuery || title, mode: 'improve', shopifyId, handle, liveSnapshot, gscQueries: topQuery ? [topQuery] : [] }, status: 'queued' });
  await inngest.send({
    name: 'seo/job.requested',
    data: { storeId, keyword: topQuery || title, type: resourceType, jobId: job.id, mode: 'improve', shopifyId, handle, liveSnapshot, gscQueries: topQuery ? [topQuery] : [] },
  });
  await setFindingStatus(id, 'queued');
  revalidatePath('/seo/findings');
  revalidatePath('/');
}

async function runAudit() {
  'use server';
  const storeId = await getActiveStoreId();
  if (storeId) {
    await inngest.send({ name: 'seo/audit.requested', data: { storeId } });
    revalidatePath('/seo/findings');
  }
}

function severityTone(severity: string | undefined): StatusTone {
  const value = (severity || '').toLowerCase();
  if (value === 'high' || value === 'critical') return 'danger';
  if (value === 'medium') return 'warn';
  return 'info';
}

export const dynamic = 'force-dynamic';

export default async function SeoFindings() {
  let findings: any[] = [];
  try {
    const storeId = await getActiveStoreId();
    if (storeId) findings = await listOpenFindings(storeId, 100);
  } catch {}

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Recommendations"
        lede="Open findings from catalog and Search Console. Improve starts an SEO job."
        backHref="/seo"
        actions={
          <form action={runAudit}>
            <button type="submit" className="btn-secondary">Run audit</button>
          </form>
        }
      />
      <SeoSubnav />

      {findings.length === 0 ? (
        <EmptyState
          message="No open findings. Run an audit after catalog and Search Console sync."
          action={
            <form action={runAudit}>
              <button type="submit" className="btn-cta">Run audit</button>
            </form>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Title</th>
                <th>Resource</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f: any) => {
                const q = f.detail?.query || '';
                return (
                  <tr key={f.id}>
                    <td data-label="Kind">
                      {f.kind}{' '}
                      {f.severity ? (
                        <StatusBadge label={f.severity} tone={severityTone(f.severity)} />
                      ) : null}
                    </td>
                    <td data-label="Title">{f.title}</td>
                    <td data-label="Resource">{[f.resourceType, f.handle].filter(Boolean).join(' ') || '—'}</td>
                    <td data-label="Actions">
                      <div className="cx-actions" style={{ marginTop: 0 }}>
                        <form action={improveFromFinding}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="shopifyId" value={f.shopifyId || ''} />
                          <input type="hidden" name="handle" value={f.handle || ''} />
                          <input type="hidden" name="resourceType" value={f.resourceType || ''} />
                          <input type="hidden" name="query" value={q} />
                          <input type="hidden" name="title" value={f.title || ''} />
                          <input type="hidden" name="detail" value={JSON.stringify(f.detail || {})} />
                          <button type="submit" className="btn-secondary">Improve</button>
                        </form>
                        <form action={dismissFinding}>
                          <input type="hidden" name="id" value={f.id} />
                          <button type="submit" className="btn-secondary">Dismiss</button>
                        </form>
                        {f.kind === 'content_gap' ? (
                          <Link href={`/seo/create?keyword=${encodeURIComponent(q)}`} className="btn-cta">
                            Create
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
