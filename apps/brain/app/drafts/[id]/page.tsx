import { getDraft, updateDraft } from '@/src/lib/db/drafts';
import { updateJobStatus, getJob } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { authorizeApprover } from '@/lib/sensitive-auth';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { logEvent } from '@/src/lib/brain/events';
import { isWordpressApplyWritable } from '@cerevex/contracts';
import {
  isWordpressStore,
  wordpressApplyBlockedByKillSwitch,
  wordpressFlagsFromStore,
} from '@/src/lib/wordpress';
import { gscApplyIsWritable, isGscSourcedJob } from '@/src/lib/seo/gsc-flags';
import { GSC_APPLY_OFF_REVIEW_COPY } from '@/src/lib/seo/gsc-copy';
import { PageHeader } from '@/components/page-header';
import { jobStatusLabel, jobSubject, jobTypeLabel } from '@/lib/job-labels';

async function decide(formData: FormData) {
  'use server';
  const jar = await cookies();
  const gate = authorizeApprover({
    cookie: jar.get(AUTH_COOKIE_NAME)?.value ?? null,
    internalKey: null,
  });
  if (!gate.ok) redirect('/login');
  const draftId = formData.get('draftId') as string;
  const status = formData.get('status') as string;
  const notes = formData.get('notes') as string || '';
  const jobId = formData.get('jobId') as string;
  let storeId = await getActiveStoreId();
  if (!storeId) storeId = null as any; // will be handled if needed, but draft load uses id

  let editedPayload: any = undefined;
  if (status === 'edited') {
    // Build metafields as typed array (P1): from per-slot fields + additional JSON
    const mfs: Array<{namespace: string; key: string; type?: string; value: string}> = [];
    // collect slot values if provided e.g. mfslot_0_value
    for (const [k, v] of formData.entries()) {
      if (k.startsWith('mfslot_') && k.endsWith('_value') && v) {
        const idx = k.replace('mfslot_','').replace('_value','');
        const ns = formData.get(`mfslot_${idx}_ns`) as string || 'custom';
        const ky = formData.get(`mfslot_${idx}_key`) as string || '';
        const ty = formData.get(`mfslot_${idx}_type`) as string || undefined;
        if (ky) mfs.push({ namespace: ns, key: ky, type: ty, value: String(v) });
      }
    }
    let mfStr = formData.get('metafields') as string;
    if (mfStr) {
      try {
        const addl = JSON.parse(mfStr);
        if (Array.isArray(addl)) {
          for (const a of addl) if (a && a.key) mfs.push({namespace: a.namespace||'custom', key: a.key, type: a.type, value: String(a.value||'')});
        } else if (addl && typeof addl === 'object') {
          for (const [full, val] of Object.entries(addl)) {
            let ns='custom', ky=full;
            if (full.includes('.')) { const p=full.split('.'); ns=p[0]; ky=p.slice(1).join('.'); }
            mfs.push({namespace: ns, key: ky, value: String(val)});
          }
        }
      } catch {}
    }
    const metafields = mfs.length ? mfs : undefined;
    let schemaJsonLd = undefined;
    const sjStr = formData.get('schemaJsonLd') as string;
    if (sjStr) { try { schemaJsonLd = JSON.parse(sjStr); } catch {} }
    let selectedProducts = undefined;
    const spStr = formData.get('selectedProducts') as string;
    if (spStr) { try { selectedProducts = JSON.parse(spStr); } catch {} }
    editedPayload = {
      title: formData.get('title'),
      handle: formData.get('handle'),
      bodyHtml: formData.get('bodyHtml'),
      metaTitle: formData.get('metaTitle'),
      metaDescription: formData.get('metaDescription'),
      metafields,
      schemaJsonLd,
      selectedProducts,
    };
    await updateDraft(draftId, editedPayload);
  }

  const job = jobId ? await getJob(jobId).catch(() => null) : null;
  const isWordpressJob = job?.type === 'seo.wordpress';
  if (isWordpressJob) {
    const store = job?.storeId ? await getStore(job.storeId) : null;
    const flags = wordpressFlagsFromStore(store);
    if (status === 'rejected' || status === 'snoozed') {
      await updateJobStatus(jobId, status);
      await logEvent(job.storeId, 'human', `wordpress.${status}`, { notes, jobId }, jobId);
      const { revalidatePath } = await import('next/cache');
      revalidatePath('/review');
      redirect('/review?success=decision-submitted');
    }
    const draft = await getDraft(draftId);
    const brief = draft?.brief || {};
    const payload = {
      approved: true as const,
      approvalId: draftId,
      approvedAt: new Date().toISOString(),
      storeId: job.storeId,
      externalId: String(brief.externalId || job.input?.externalId || ''),
      resourceType: (brief.resourceType || job.input?.resourceType || 'page') as 'post' | 'page',
      title: editedPayload?.title || draft?.title,
      bodyHtml: editedPayload?.bodyHtml || draft?.bodyHtml,
      seoTitle: editedPayload?.metaTitle || draft?.metaTitle,
      seoDescription: editedPayload?.metaDescription || draft?.metaDescription,
    };
    if (!store || !isWordpressStore(store) || !isWordpressApplyWritable(flags) || wordpressApplyBlockedByKillSwitch(store)) {
      await updateJobStatus(jobId, 'approved');
      await logEvent(job.storeId, 'human', 'wordpress.apply.blocked', {
        notes,
        killSwitch: store ? wordpressApplyBlockedByKillSwitch(store) : false,
        applyOff: !isWordpressApplyWritable(flags),
      }, jobId);
      const { revalidatePath } = await import('next/cache');
      revalidatePath('/review');
      redirect('/review?success=decision-submitted');
    }
    await updateJobStatus(jobId, 'publishing');
    await logEvent(job.storeId, 'human', 'wordpress.approved', { notes, approvalId: draftId }, jobId);
    let enqueued = true;
    try {
      await inngest.send({
        name: 'seo/wordpress.apply',
        data: { storeId: job.storeId, payload, actor: 'human', jobId },
      });
    } catch (e: any) {
      console.error('Failed to enqueue WordPress apply', e);
      enqueued = false;
      await updateJobStatus(jobId, 'awaiting_approval');
    }
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/review');
    if (!enqueued) redirect(`/drafts/${draftId}?error=send_failed`);
    redirect('/review?success=decision-submitted');
  }

  try {
    await inngest.send({ name: 'approval/decided', data: { status, notes, editedPayload, jobId, draftId } });
  } catch (e: any) {
    console.error('Failed to send approval to Inngest', e);
    redirect(`/drafts/${draftId}?error=send_failed`);
  }

  const finalStatus = status === 'approved' || status === 'edited' ? 'approved' : status === 'snoozed' ? 'snoozed' : 'rejected';
  await updateJobStatus(jobId, finalStatus);

  const { revalidatePath } = await import('next/cache');
  revalidatePath('/review');
  revalidatePath('/');
  redirect('/review?success=decision-submitted');
}

export const dynamic = 'force-dynamic';

export default async function DraftDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const query = (await (searchParams ?? Promise.resolve({}))) as { error?: string };
  let draft: any = null;
  let loadError: string | null = null;
  try {
    draft = await getDraft(id);
  } catch (e: any) {
    loadError = e.message || 'Failed to load draft';
  }
  if (!draft && !loadError) notFound();

  if (loadError) {
    return (
      <div className="cx-page">
        <PageHeader title="Draft" backHref="/review" backLabel="← Review" />
        <p className="cx-banner cx-banner-warn" role="status">Could not load this draft: {loadError}</p>
      </div>
    );
  }
  if (!draft) notFound();

  let brandVoice: any = null;
  let jobInput: any = null;
  let jobType = 'collection';
  let jobStatus = '';
  let wordpressApplyOn = true;
  let gscApplyOn = true;
  let gscJob = false;
  try {
    const j = await getJob(draft.jobId);
    jobInput = j?.input || null;
    brandVoice = j?.input?.brandVoice || null;
    jobType = j?.type || 'collection';
    jobStatus = j?.status || '';
    gscJob = isGscSourcedJob(j?.input);
    if (j?.storeId) {
      const s = await getStore(j.storeId);
      if (j?.type === 'seo.wordpress') {
        wordpressApplyOn = isWordpressApplyWritable(wordpressFlagsFromStore(s));
      }
      if (gscJob) gscApplyOn = gscApplyIsWritable(s);
    }
  } catch {}

  let placement: any = null;
  try {
    const sid = draft.storeId || await getActiveStoreId();
    if (sid) {
      const s = await getStore(sid);
      const rawPlacement = s?.config?.placement || null;
      placement = rawPlacement ? (rawPlacement[jobType] || rawPlacement.default || rawPlacement) : null;
    }
  } catch {}

  return (
    <div className="cx-page cx-draft">
      <PageHeader
        kicker={jobTypeLabel(jobType)}
        title={draft.title}
        lede={[
          jobSubject(jobInput) ? `Keyword: ${jobSubject(jobInput)}` : null,
          draft.handle ? `URL: /${draft.handle}` : null,
          jobStatus ? jobStatusLabel(jobStatus) : null,
        ].filter(Boolean).join(' · ')}
        backHref="/review"
        backLabel="← Review"
      />

      {query.error === 'send_failed' ? (
        <p className="cx-banner cx-banner-warn" role="status">
          Your decision was not sent, so nothing changed. Try again in a moment.
        </p>
      ) : null}

      <section className="cx-panel">
        <h2>Preview</h2>
        <div className="cx-html-preview" dangerouslySetInnerHTML={{ __html: draft.bodyHtml }} />
      </section>

      <section className="cx-panel">
        <h2>Search listing</h2>
        <dl className="cx-draft-meta">
          <div>
            <dt>SEO title</dt>
            <dd>{draft.metaTitle || '—'}</dd>
          </div>
          <div>
            <dt>Meta description</dt>
            <dd>{draft.metaDescription || '—'}</dd>
          </div>
        </dl>
      </section>

      {draft.selectedProducts && draft.selectedProducts.length > 0 && (
        <section className="cx-panel">
          <h2>Products ({draft.selectedProducts.length})</h2>
          <ul className="text-sm list-disc pl-5">
            {draft.selectedProducts.map((p: any, i: number) => (
              <li key={i}>{p.title || p.handle || 'Untitled product'}</li>
            ))}
          </ul>
        </section>
      )}

      {(draft.rawResearch || draft.evaluationScores || draft.brief || brandVoice) && (
        <details className="cx-details cx-panel">
          <summary>How this was made</summary>
          {brandVoice ? <p className="cx-help">Brand voice: {brandVoice.text || 'Custom'}</p> : null}
          {draft.rawResearch?.summary ? <p className="cx-help">Research: {draft.rawResearch.summary.slice(0, 400)}</p> : null}
          {draft.evaluationScores?.topicGate ? (
            <p className="cx-help">
              Topic check: {draft.evaluationScores.topicGate.onTopic ? 'on topic' : 'off topic'}
              {draft.evaluationScores.topicGate.violations?.length
                ? ` — ${draft.evaluationScores.topicGate.violations.join('; ')}`
                : ''}
            </p>
          ) : null}
          <p className="cx-help">
            <Link href={`/jobs/${draft.jobId}`}>View activity for this draft</Link>
          </p>
        </details>
      )}

      {jobStatus === 'awaiting_approval' && (
      <form action={decide} className="cx-panel space-y-4">
        <input type="hidden" name="draftId" value={draft.id} />
        <input type="hidden" name="jobId" value={draft.jobId} />
        {!wordpressApplyOn && jobType === 'seo.wordpress' ? (
          <p className="text-sm">WordPress apply is off. You can Deny or Snooze. Approve will not write the site.</p>
        ) : null}
        {gscJob && !gscApplyOn ? (
          <p className="text-sm">{GSC_APPLY_OFF_REVIEW_COPY}</p>
        ) : null}

        <h2>Your decision</h2>
        <div>
          <label className="block mb-1" htmlFor="draft-decision">Decision</label>
          <select id="draft-decision" name="status" className="w-full">
            {wordpressApplyOn || jobType !== 'seo.wordpress' ? (
              <>
                <option value="approved">Approve</option>
                <option value="edited">Edit &amp; Approve</option>
              </>
            ) : null}
            <option value="rejected">Deny</option>
            <option value="snoozed">Snooze</option>
          </select>
        </div>

        <div>
          <label className="block mb-1" htmlFor="draft-notes">Notes (optional)</label>
          <textarea id="draft-notes" name="notes" className="w-full h-20" />
        </div>

        <details className="cx-details">
          <summary>Edit before approving</summary>
          <p className="cx-help">Changes here are used when you choose Edit &amp; Approve.</p>
          <label className="block mb-1 text-sm" htmlFor="draft-title">Title</label>
          <input id="draft-title" name="title" defaultValue={draft.title} className="w-full mb-2" />
          <label className="block mb-1 text-sm" htmlFor="draft-handle">URL handle</label>
          <input id="draft-handle" name="handle" defaultValue={draft.handle} className="w-full mb-2" />
          <label className="block mb-1 text-sm" htmlFor="draft-meta-title">SEO title</label>
          <input id="draft-meta-title" name="metaTitle" defaultValue={draft.metaTitle} className="w-full mb-2" />
          <label className="block mb-1 text-sm" htmlFor="draft-meta-desc">Meta description</label>
          <input id="draft-meta-desc" name="metaDescription" defaultValue={draft.metaDescription} className="w-full mb-2" />
          <label className="block mb-1 text-sm" htmlFor="draft-body">Page content (HTML)</label>
          <textarea id="draft-body" name="bodyHtml" defaultValue={draft.bodyHtml} className="w-full h-40" />
           {placement && placement.metafields && Array.isArray(placement.metafields) && placement.metafields.length > 0 && (
             <div className="mt-2">
               <div className="text-xs font-medium mb-1">Custom fields</div>
               {placement.metafields.map((rule: any, i: number) => {
                 const t = rule.target || {};
                 const cur = Array.isArray(draft.metafields) ? draft.metafields.find((m:any)=> m.namespace===t.namespace && m.key===t.key) : null;
                 const defVal = cur ? cur.value : '';
                 return (
                   <div key={i} className="mb-1">
                     <input type="hidden" name={`mfslot_${i}_ns`} value={t.namespace || 'custom'} />
                     <input type="hidden" name={`mfslot_${i}_key`} value={t.key || ''} />
                     <input type="hidden" name={`mfslot_${i}_type`} value={t.type || ''} />
                     <label className="text-[10px] block">{t.namespace}.{t.key} ({t.type || 'text'})</label>
                     <textarea name={`mfslot_${i}_value`} defaultValue={defVal} className="border p-1 w-full h-12 font-mono text-xs" placeholder="value for this slot" />
                   </div>
                 );
               })}
             </div>
           )}
          <details className="cx-details mt-2">
            <summary>Advanced</summary>
            <label className="block mb-1 text-xs" htmlFor="draft-metafields">Metafields (JSON)</label>
            <textarea id="draft-metafields" name="metafields" defaultValue={draft.metafields ? JSON.stringify(draft.metafields, null, 2) : ''} className="w-full h-16 font-mono text-xs" />
            <label className="block mb-1 text-xs" htmlFor="draft-schema">Structured data (JSON-LD)</label>
            <textarea id="draft-schema" name="schemaJsonLd" defaultValue={draft.schemaJsonLd ? JSON.stringify(draft.schemaJsonLd, null, 2) : ''} className="w-full h-20 font-mono text-xs" />
            <label className="block mb-1 text-xs" htmlFor="draft-products">Products (JSON)</label>
            <textarea id="draft-products" name="selectedProducts" defaultValue={draft.selectedProducts ? JSON.stringify(draft.selectedProducts, null, 2) : ''} className="w-full h-16 font-mono text-xs" />
          </details>
        </details>

        <button type="submit" className="btn-cta">Submit decision</button>
      </form>
      )}
    </div>
  );
}
