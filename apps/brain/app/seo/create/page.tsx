import { createJob, updateJobStatus } from '@/src/lib/db/jobs';
import { inngest } from '@/src/inngest/client';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';

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
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="New content"
        lede="Queue a collection, page, or blog post for this store."
        backHref="/seo"
      />
      <SeoSubnav />

      <section className="cx-panel" style={{ maxWidth: '40rem' }}>
        <form action={triggerSeoJob} className="cx-form cx-form-inline">
          <div className="cx-field">
            <label htmlFor="keyword">Keyword</label>
            <input
              id="keyword"
              name="keyword"
              defaultValue={params.keyword || ''}
              placeholder="e.g. daikin single zone mini split"
              required
            />
            <p className="cx-help">The search phrase this page should rank for.</p>
          </div>
          <div className="cx-field">
            <label htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue="collection">
              <option value="collection">Collection</option>
              <option value="page">Page</option>
              <option value="blog">Blog Post</option>
            </select>
            <p className="cx-help">What to create.</p>
          </div>
          <div className="cx-field cx-field-action">
            <button type="submit" className="btn-cta">Create</button>
          </div>
        </form>
        <p className="cx-help">This starts an SEO job. Approval is required unless store autonomy turns it off.</p>
      </section>

      <p>
        <Link href="/seo/findings">See open recommendations</Link>
      </p>
    </div>
  );
}
