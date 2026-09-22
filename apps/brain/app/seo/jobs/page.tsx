import Link from 'next/link';
import { getActiveStoreId } from '@/src/lib/db/stores';
import { listJobs } from '@/src/lib/db/jobs';

export const dynamic = 'force-dynamic';

export default async function SeoJobs() {
  const storeId = await getActiveStoreId();
  let jobs: any[] = [];
  try { if (storeId) jobs = await listJobs(storeId, 50); } catch {}
  const seoJobs = jobs.filter((j: any) => j.domain === 'seo' || true); // all are seo for now
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <Link href="/seo" className="underline">← Overview</Link>
      <h1 className="text-2xl font-bold mt-4">SEO Jobs</h1>
      <table className="w-full border mt-4 text-sm">
        <thead><tr className="bg-muted"><th className="p-2">ID</th><th>Type</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {seoJobs.length === 0 && <tr><td colSpan={5} className="p-3">No jobs</td></tr>}
          {seoJobs.map((j:any)=>(
            <tr key={j.id} className="border-t"><td className="p-2 font-mono text-xs">{j.id.slice(0,8)}</td><td>{j.type}</td><td>{j.status}</td><td>{new Date(j.createdAt).toLocaleString()}</td><td><Link href={`/jobs/${j.id}`} className="underline">View</Link></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
