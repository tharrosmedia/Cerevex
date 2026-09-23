import Link from 'next/link';
import { getActiveStoreId } from '@/src/lib/db/stores';
import { listJobs } from '@/src/lib/db/jobs';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';
import { jobTypeLabel } from '@/lib/job-labels';

export const dynamic = 'force-dynamic';

export default async function SeoJobs() {
  const storeId = await getActiveStoreId();
  let jobs: any[] = [];
  try { if (storeId) jobs = await listJobs(storeId, 50); } catch {}
  const seoJobs = jobs.filter((j: any) => j.domain === 'seo' || true);

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="SEO jobs"
        lede="Queued, running, and finished SEO work for this store."
        backHref="/seo"
      />
      <SeoSubnav />

      {seoJobs.length === 0 ? (
        <EmptyState
          message="No SEO jobs yet. Create a page or run an audit to start one."
          actionHref="/seo/create"
          actionLabel="Create"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {seoJobs.map((j: any) => (
                <tr key={j.id}>
                  <td data-label="ID">{j.id.slice(0, 8)}</td>
                  <td data-label="Type">{jobTypeLabel(j.type)}</td>
                  <td data-label="Status"><StatusBadge status={j.status} /></td>
                  <td data-label="Created">{new Date(j.createdAt).toLocaleString()}</td>
                  <td data-label="Open">
                    <Link href={`/jobs/${j.id}`} className="btn-secondary">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
