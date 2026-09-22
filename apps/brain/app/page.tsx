import { listJobs } from '@/src/lib/db/jobs';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';
import AutoRefresh from '@/components/auto-refresh';
import { countOpenFindings } from '@/src/lib/db/findings';

export const dynamic = 'force-dynamic';

export default async function CommandCenter() {
  let storeId = await getActiveStoreId();
  const allStores = await listStores();
  if (!storeId && allStores.length > 0) {
    storeId = allStores[0].id;
    const c = await cookies();
    if (storeId) {
      c.set('activeStoreId', storeId, {
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
    }
  }
  let jobs: any[] = [];
  let openFindings = 0;
  let loadError: string | null = null;
  try {
    if (storeId) {
      jobs = await listJobs(storeId, 20);
      openFindings = await countOpenFindings(storeId);
    }
  } catch (e: any) {
    loadError = e.message || 'Failed to load data';
  }

  const awaitingApproval = jobs.filter((j: any) => j.status === 'awaiting_approval').length;
  const seoAwaiting = awaitingApproval; // jobs are seo domain
  const completed = jobs.filter((j: any) => j.status === 'completed').length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Shopify Brain</h1>
      <AutoRefresh interval={4000} />

      {allStores.length === 0 && (
        <div className="mb-6 p-4 border border-blue-200 bg-blue-50 rounded">
          <p className="font-semibold mb-2">Welcome! Get started by adding your Shopify store.</p>
          <Link href="/stores" className="inline-block bg-black text-white px-4 py-2 rounded text-sm">Go to Store Management →</Link>
          <p className="text-sm mt-2 text-muted-foreground">Once added, it will be auto-selected.</p>
        </div>
      )}

      {loadError && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
          Error loading data: {loadError}. Make sure DATABASE_URL is set and migration has run.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Link href="/seo" className="border p-4 rounded block hover:bg-muted">
          <div className="text-sm text-muted-foreground">SEO</div>
          <div className="text-3xl font-bold">{seoAwaiting} awaiting</div>
          <div className="text-xs text-muted-foreground">{openFindings} findings</div>
        </Link>
        <Link href="/review" className="border p-4 rounded block hover:bg-muted">
          <div className="text-sm text-muted-foreground">Review</div>
          <div className="text-3xl font-bold">{awaitingApproval}</div>
          <div className="text-xs">global approval queue</div>
        </Link>
        <Link href="/stores" className="border p-4 rounded block hover:bg-muted">
          <div className="text-sm text-muted-foreground">Stores</div>
          <div className="text-3xl font-bold">{allStores.length}</div>
        </Link>
        <div className="border p-4 rounded opacity-60">
          <div className="text-sm text-muted-foreground">Ads / Inventory / Service / Fulfillment</div>
          <div className="text-sm">Not enabled</div>
        </div>
      </div>

      <div className="mb-4">
        <Link href="/seo/create" className="underline">Trigger job → /seo/create</Link>
      </div>

      <div>
        <h2 className="font-semibold mb-4">Recent Jobs</h2>
        <table className="w-full border">
          <thead>
            <tr className="bg-muted">
              <th className="p-2 text-left">ID</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Input</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Created</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && !loadError && (
              <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No jobs yet for this store.</td></tr>
            )}
            {jobs.map((job: any) => (
              <tr key={job.id} className="border-t">
                <td className="p-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                <td className="p-2">{job.type}</td>
                <td className="p-2 text-xs">{JSON.stringify(job.input).slice(0,120)}</td>
                <td className="p-2">{job.status}</td>
                <td className="p-2 text-sm">{new Date(job.createdAt).toLocaleString()}</td>
                <td className="p-2">
                  <Link href={`/jobs/${job.id}`} className="underline">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 text-sm">
        <Link href="/seo" className="underline mr-4">SEO Command Center</Link>
        <Link href="/review" className="underline mr-4">Review Queue</Link>
        <Link href="/history" className="underline">Full History</Link>
      </div>
    </div>
  );
}
