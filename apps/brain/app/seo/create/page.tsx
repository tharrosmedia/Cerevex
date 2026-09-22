import { createJob, updateJobStatus } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cookies } from 'next/headers';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';
import { redirect } from 'next/navigation';

async function triggerSeoJob(formData: FormData) {
  'use server';
  const keyword = formData.get('keyword') as string;
  const type = (formData.get('type') as string) || 'collection';
  if (!keyword) return;
  let storeId = await getActiveStoreId();
  if (!storeId) {
    redirect('/stores?error=no-store');
  }
  const stores = await listStores();
  const current = stores.find((s: any) => s.id === storeId) || stores[0];
  const platform = current?.platform || 'shopify';
  const brandVoice = current?.config?.brandVoice;
  const seoRules = current?.config?.seoRules;
  const autonomy = current?.config?.autonomy;
  if (autonomy?.allowedTypes && !autonomy.allowedTypes.includes(type)) {
    throw new Error(`Type ${type} not allowed for this store per autonomy config`);
  }
  const c = await cookies();
  if (storeId) {
    c.set('activeStoreId', storeId, { path: '/', secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
  }
  const job = await createJob({ storeId, domain: 'seo', type, input: { keyword, platform, brandVoice, seoRules }, status: 'queued' });
  console.log('[INNGEST] sending seo/job.requested from /seo/create', { jobId: job.id });
  try {
    await inngest.send({ name: 'seo/job.requested', data: { storeId, keyword, type, platform, brandVoice, seoRules, jobId: job.id } });
  } catch (e: any) {
    await updateJobStatus(job.id, 'failed');
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/seo/create');
    throw new Error(`Failed to queue: ${e.message || e}`);
  }
  const { revalidatePath } = await import('next/cache');
  revalidatePath('/seo/create');
  revalidatePath('/');
  redirect('/seo/jobs');
}

export const dynamic = 'force-dynamic';

export default async function SeoCreate({ searchParams }: { searchParams?: Promise<{ keyword?: string }> }) {
  const params = await (searchParams || Promise.resolve({})) as { keyword?: string };
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/seo" className="underline mb-4 block">← SEO Overview</Link>
      <h1 className="text-3xl font-bold mb-6">New content</h1>
      <div className="mb-8 border p-4 rounded max-w-xl">
        <form action={triggerSeoJob} className="flex gap-2">
          <input name="keyword" defaultValue={params.keyword || ''} placeholder="e.g. daikin single zone mini split" className="border p-2 flex-1" required />
          <select name="type" defaultValue="collection" className="border p-2">
            <option value="collection">Collection</option>
            <option value="page">Page</option>
            <option value="blog">Blog Post</option>
          </select>
          <Button type="submit">Create</Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">This enqueues an SEO job. Approval required unless store autonomy disables it.</p>
      </div>
      <div>
        <Link href="/seo/findings" className="underline">See recommendations for improve opportunities</Link>
      </div>
    </div>
  );
}
