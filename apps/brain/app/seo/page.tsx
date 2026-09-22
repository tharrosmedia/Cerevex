import Link from 'next/link';
import { getActiveStoreId, listStores } from '@/src/lib/db/stores';
import { listJobs } from '@/src/lib/db/jobs';
import { countOpenFindings } from '@/src/lib/db/findings';
import AutoRefresh from '@/components/auto-refresh';

export const dynamic = 'force-dynamic';

export default async function SeoOverview() {
  const storeId = await getActiveStoreId();
  const stores = await listStores();
  let awaiting = 0;
  let findings = 0;
  let recent: any[] = [];
  try {
    if (storeId) {
      const jobs = await listJobs(storeId, 10);
      awaiting = jobs.filter((j: any) => j.status === 'awaiting_approval').length;
      findings = await countOpenFindings(storeId);
      recent = jobs;
    }
  } catch {}
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">SEO Command Center</h1>
      <p className="text-sm text-muted-foreground mb-6">Active store: {stores.find((s:any)=>s.id===storeId)?.name || 'none'}</p>
      <AutoRefresh interval={5000} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link href="/seo/findings" className="border p-4 rounded hover:bg-muted">
          <div className="text-sm">Open Findings</div>
          <div className="text-3xl font-bold">{findings}</div>
        </Link>
        <Link href="/seo/jobs" className="border p-4 rounded hover:bg-muted">
          <div className="text-sm">Awaiting Approval (SEO)</div>
          <div className="text-3xl font-bold">{awaiting}</div>
        </Link>
        <Link href="/seo/create" className="border p-4 rounded hover:bg-muted">
          <div>New content</div>
          <div className="underline mt-2">Create →</div>
        </Link>
      </div>

      <div className="mb-4">
        <Link href="/seo/live" className="underline mr-4">Live catalog</Link>
        <Link href="/seo/search" className="underline mr-4">Search Console</Link>
        <Link href="/seo/findings" className="underline mr-4">Recommendations</Link>
        <Link href="/seo/jobs" className="underline">SEO Jobs</Link>
      </div>

      <div>
        <h2 className="font-semibold mb-2">Recent SEO Jobs</h2>
        <table className="w-full border text-sm">
          <thead><tr className="bg-muted"><th className="p-2 text-left">ID</th><th>Type</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><td colSpan={5} className="p-3 text-muted-foreground">None yet</td></tr>}
            {recent.map((j:any) => (
              <tr key={j.id} className="border-t">
                <td className="p-2 font-mono text-xs">{j.id.slice(0,8)}</td>
                <td>{j.type}</td>
                <td>{j.status}</td>
                <td>{new Date(j.createdAt).toLocaleString()}</td>
                <td><Link href={`/jobs/${j.id}`} className="underline">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
