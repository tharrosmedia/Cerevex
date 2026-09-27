import Link from 'next/link';
import { getActiveStoreId } from '@/src/lib/db/stores';
import { listJobs } from '@/src/lib/db/jobs';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';
import { jobSubject, jobTypeLabel } from '@/lib/job-labels';
import { formatWhen } from '@/lib/labels';
import { operatorLoadError } from '@/lib/ui-copy';

export const dynamic = 'force-dynamic';

const LIMIT = 50;

export default async function SeoJobs() {
  let jobs: any[] = [];
  let loadError: string | null = null;
  try {
    const storeId = await getActiveStoreId();
    if (storeId) jobs = await listJobs(storeId, LIMIT);
  } catch (e: any) {
    loadError = operatorLoadError(e?.message) || 'Could not load jobs.';
  }

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="SEO jobs"
        lede="Content Cerevex is researching, writing, or publishing for this store."
        backHref="/seo"
      />
      <SeoSubnav />

      {loadError ? <p className="cx-banner cx-banner-warn" role="status">Could not load jobs: {loadError}</p> : null}

      {!loadError && jobs.length === 0 ? (
        <EmptyState
          message="No SEO jobs yet. Create content or draft a fix from Recommendations to start one."
          actionHref="/seo/create"
          actionLabel="Create content"
        />
      ) : null}

      {jobs.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Working on</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j: any) => (
                  <tr key={j.id}>
                    <td data-label="Working on">
                      <Link href={`/jobs/${j.id}`}>{jobSubject(j.input) || 'Untitled job'}</Link>
                    </td>
                    <td data-label="Type">{jobTypeLabel(j.type)}</td>
                    <td data-label="Status"><StatusBadge status={j.status} /></td>
                    <td data-label="Started">{formatWhen(j.createdAt)}</td>
                    <td data-label="Open">
                      <Link href={`/jobs/${j.id}`} className="btn-secondary">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {jobs.length >= LIMIT ? <p className="cx-help">Showing the newest {LIMIT} jobs.</p> : null}
        </>
      ) : null}
    </div>
  );
}
