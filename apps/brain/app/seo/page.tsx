import Link from 'next/link';
import { getActiveStoreId, listStores } from '@/src/lib/db/stores';
import { listJobs } from '@/src/lib/db/jobs';
import { countOpenFindings } from '@/src/lib/db/findings';
import AutoRefresh from '@/components/auto-refresh';
import { EmptyState } from '@/components/empty-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';
import { jobTypeLabel } from '@/lib/job-labels';

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
  const storeName = stores.find((s: any) => s.id === storeId)?.name || 'none';

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="SEO"
        lede={`Active store: ${storeName}. Open findings, review work, or start a new page.`}
      />
      <SeoSubnav />
      <AutoRefresh interval={5000} />

      <section className="cx-card-grid" aria-label="SEO stats">
        <MetricCard
          href="/seo/findings"
          label="Open findings"
          value={findings}
          hint={findings === 1 ? 'recommendation waiting' : 'recommendations waiting'}
        />
        <MetricCard
          href="/seo/jobs"
          label="Awaiting approval"
          value={awaiting}
          hint={awaiting === 1 ? 'SEO job to review' : 'SEO jobs to review'}
        />
        <MetricCard
          href="/seo/create"
          label="New content"
          value="Create"
          hint="Write a collection, page, or post"
        />
      </section>

      <section>
        <div className="cx-section-head">
          <h2>Recent SEO jobs</h2>
          <Link href="/seo/jobs" className="btn-secondary">All jobs</Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            message="No SEO jobs yet for this store."
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
                {recent.map((j: any) => (
                  <tr key={j.id}>
                    <td data-label="ID" className="cx-mono">{j.id.slice(0, 8)}</td>
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
      </section>
    </div>
  );
}
