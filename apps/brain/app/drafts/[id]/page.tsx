import { getDraft, updateDraft } from '@/src/lib/db/drafts';
import { updateJobStatus, getJob } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getActiveStoreId, getStore } from '@/src/lib/db/stores';
import { createAdminClient } from '@/src/lib/shopify/client';
import { fetchMetafieldDefinitions } from '@/src/lib/shopify/content';

async function decide(formData: FormData) {
  'use server';
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

  console.log('[INNGEST] sending approval/decided', { jobId, status });
  try {
    await inngest.send({ name: 'approval/decided', data: { status, notes, editedPayload, jobId, draftId } });
    console.log('[INNGEST] approval send completed for', jobId);
  } catch (e: any) {
    console.error('Failed to send approval to Inngest', e);
  }

  const finalStatus = status === 'approved' || status === 'edited' ? 'approved' : 'rejected';
  await updateJobStatus(jobId, finalStatus);

  const { revalidatePath } = await import('next/cache');
  revalidatePath('/review');
  revalidatePath('/');
  redirect('/review?success=decision-submitted');
}

export const dynamic = 'force-dynamic';

export default async function DraftDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      <div className="p-8 max-w-4xl mx-auto">
        <Link href="/review" className="underline">← Back to Review</Link>
        {' | '}
        <Link href={`/jobs/${draft?.jobId || ''}`} className="underline">← Back to Job</Link>
        <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">Error: {loadError}</div>
      </div>
    );
  }
  if (!draft) notFound();

  let brandVoice: any = null;
  let jobType = 'collection';
  let jobStatus = '';
  try {
    const j = await getJob(draft.jobId);
    brandVoice = j?.input?.brandVoice || null;
    jobType = j?.type || 'collection';
    jobStatus = j?.status || '';
  } catch {}

  let availableMetafields: any[] = [];
  let placement: any = null;
  try {
    const sid = draft.storeId || await getActiveStoreId();
    if (sid) {
      const s = await getStore(sid);
      if (s) {
        const rawPlacement = s.config?.placement || null;
        const typePlacement = rawPlacement ? (rawPlacement[jobType] || rawPlacement.default || rawPlacement) : null;
        placement = typePlacement;
        if (s.shopify_access_token) {
          const client = createAdminClient(s.shopify_domain, s.shopify_access_token);
          availableMetafields = await fetchMetafieldDefinitions(client);
        }
      }
    }
  } catch {}

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href="/review" className="underline">← Back to Review</Link>
      {' | '}
      <Link href={`/jobs/${draft.jobId}`} className="underline">← Back to Job</Link>
      <h1 className="text-2xl font-bold mt-4 mb-2">{draft.title}</h1>
      {brandVoice && (
        <div className="text-xs mb-2 text-muted-foreground">Brand Voice: {brandVoice.text || JSON.stringify(brandVoice)}</div>
      )}
      <p className="text-sm text-muted-foreground mb-4">Handle: {draft.handle} | Job: {draft.jobId}</p>
      <p className="text-sm mb-4"><Link href={`/jobs/${draft.jobId}`} className="underline">View full job audit</Link></p>

      <div className="border p-4 mb-6">
        <h3 className="font-semibold mb-2">Preview</h3>
        <div className="prose max-w-none border p-4 bg-white" dangerouslySetInnerHTML={{ __html: draft.bodyHtml }} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
        <div>Meta Title: {draft.metaTitle}</div>
        <div>Meta Desc: {draft.metaDescription}</div>
      </div>

      {draft.selectedProducts && draft.selectedProducts.length > 0 && (
        <div className="mb-6">
          <h4 className="font-medium mb-1 text-sm">Selected Products</h4>
          <ul className="text-sm list-disc pl-5">
            {draft.selectedProducts.map((p: any, i: number) => (
              <li key={i}>{p.title || p.shopifyId} ({p.handle})</li>
            ))}
          </ul>
        </div>
      )}

      {draft.metafields && (Array.isArray(draft.metafields) ? draft.metafields.length : Object.keys(draft.metafields).length) > 0 && (
        <div className="mb-4 text-xs">
          <h4 className="font-medium mb-1">Metafields</h4>
          <pre className="bg-white p-2 border overflow-auto">{JSON.stringify(draft.metafields, null, 2)}</pre>
        </div>
      )}

      {(draft.rawResearch || draft.evaluationScores || draft.brief) && (
        <div className="mb-6 text-sm border p-3 bg-muted">
          <h4 className="font-medium mb-1">Brief / Research / Gate (P2)</h4>
          {draft.brief && <div className="mb-1 text-xs">Brief: {JSON.stringify(draft.brief).slice(0,400)}...</div>}
          {draft.rawResearch?.summary && <div className="mb-1">Research: {draft.rawResearch.summary.slice(0,300)}...</div>}
          {draft.evaluationScores?.topicGate && (
            <div className="mt-1">
              Topic Gate: {draft.evaluationScores.topicGate.onTopic ? 'ON-TOPIC' : 'OFF-TOPIC'} 
              {draft.evaluationScores.topicGate.violations?.length ? ` | Violations: ${draft.evaluationScores.topicGate.violations.join('; ')}` : ''}
            </div>
          )}
          {draft.evaluationScores && <div className="text-xs mt-1">Scores: {JSON.stringify(draft.evaluationScores).slice(0,200)}</div>}
        </div>
      )}

      {availableMetafields.length > 0 && (
        <div className="mb-6 text-xs">
          <div className="font-medium mb-1">Available Metafields on store (filtered by type in editor):</div>
          <div className="max-h-20 overflow-auto border p-1 bg-muted">
            {availableMetafields.slice(0, 20).map((d: any, i: number) => (
              <span key={i} className="mr-2">{d.namespace}.{d.key} </span>
            ))}
          </div>
        </div>
      )}

      {jobStatus === 'awaiting_approval' && (
      <form action={decide} className="space-y-4 border p-4 rounded">
        <input type="hidden" name="draftId" value={draft.id} />
        <input type="hidden" name="jobId" value={draft.jobId} />

        <div>
          <label className="block mb-1">Decision</label>
          <select name="status" className="border p-2 w-full">
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
            <option value="edited">Edit &amp; Approve</option>
          </select>
        </div>

        <div>
          <label className="block mb-1">Notes</label>
          <textarea name="notes" className="border p-2 w-full h-20" />
        </div>

        <div className="border p-3">
          <h4 className="font-medium mb-2">Edit Fields (only for edited)</h4>
          <input name="title" defaultValue={draft.title} placeholder="Title" className="border p-1 w-full mb-2" />
          <input name="handle" defaultValue={draft.handle} placeholder="Handle" className="border p-1 w-full mb-2" />
          <input name="metaTitle" defaultValue={draft.metaTitle} placeholder="Meta Title" className="border p-1 w-full mb-2" />
          <input name="metaDescription" defaultValue={draft.metaDescription} placeholder="Meta Desc" className="border p-1 w-full mb-2" />
           <textarea name="bodyHtml" defaultValue={draft.bodyHtml} className="border p-1 w-full h-40" />
           {/* P1: per-slot metafield textareas from placement (server rendered) + additional JSON */}
           {placement && placement.metafields && Array.isArray(placement.metafields) && placement.metafields.length > 0 && (
             <div className="mt-2">
               <div className="text-xs font-medium mb-1">Placement Metafield Slots (edit values)</div>
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
           <textarea name="metafields" defaultValue={draft.metafields ? JSON.stringify(draft.metafields, null, 2) : ''} placeholder='Additional metafields JSON (array or record; will merge to typed array)' className="border p-1 w-full h-16 font-mono text-xs mt-2" />
           <textarea name="schemaJsonLd" defaultValue={draft.schemaJsonLd ? JSON.stringify(draft.schemaJsonLd, null, 2) : ''} placeholder='Schema JSON-LD' className="border p-1 w-full h-20 font-mono text-xs mt-1" />
           <textarea name="selectedProducts" defaultValue={draft.selectedProducts ? JSON.stringify(draft.selectedProducts, null, 2) : ''} placeholder='Selected Products JSON (array of {shopifyId, title, handle})' className="border p-1 w-full h-16 font-mono text-xs mt-2" />
        </div>

        <button type="submit" className="bg-black text-white px-6 py-2">Submit Decision</button>
      </form>
      )}
    </div>
  );
}
