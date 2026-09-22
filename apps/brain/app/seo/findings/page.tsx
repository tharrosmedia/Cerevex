import Link from 'next/link';
import { getActiveStoreId } from '@/src/lib/db/stores';
import { listOpenFindings, setFindingStatus } from '@/src/lib/db/findings';
import { createJob, updateJobStatus } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import { Button } from '@/components/ui/button';
import { revalidatePath } from 'next/cache';

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

  // liveSnapshot minimal from detail if present; for v1 use what we have in finding
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

export const dynamic = 'force-dynamic';

export default async function SeoFindings() {
  const storeId = await getActiveStoreId();
  let findings: any[] = [];
  try { if (storeId) findings = await listOpenFindings(storeId, 100); } catch {}
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/seo" className="underline">← Overview</Link>
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold mt-4">Recommendations</h1>
        <form action={runAudit}><Button type="submit" variant="outline">Run audit</Button></form>
      </div>
      <table className="w-full border mt-4 text-sm">
        <thead>
          <tr className="bg-muted"><th className="p-2">Kind</th><th>Title</th><th>Resource</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {findings.length === 0 && <tr><td colSpan={4} className="p-3">No open findings. Run audit after catalog + GSC sync.</td></tr>}
          {findings.map((f: any) => {
            const q = f.detail?.query || '';
            return (
              <tr key={f.id} className="border-t">
                <td className="p-2">{f.kind} <span className="text-xs">({f.severity})</span></td>
                <td className="p-2">{f.title}</td>
                <td className="p-2 text-xs">{f.resourceType} {f.handle}</td>
                <td className="p-2 space-x-2">
                  <form action={improveFromFinding} className="inline">
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="shopifyId" value={f.shopifyId || ''} />
                    <input type="hidden" name="handle" value={f.handle || ''} />
                    <input type="hidden" name="resourceType" value={f.resourceType || ''} />
                    <input type="hidden" name="query" value={q} />
                    <input type="hidden" name="title" value={f.title || ''} />
                    <input type="hidden" name="detail" value={JSON.stringify(f.detail || {})} />
                    <Button type="submit" size="sm" variant="outline">Improve</Button>
                  </form>
                  <form action={dismissFinding} className="inline">
                    <input type="hidden" name="id" value={f.id} />
                    <Button type="submit" size="sm" variant="ghost">Dismiss</Button>
                  </form>
                  {f.kind === 'content_gap' && (
                    <Link href={`/seo/create?keyword=${encodeURIComponent(q)}`} className="underline text-sm">Create</Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
