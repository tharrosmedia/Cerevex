import Link from 'next/link';
import { listReviewDrafts, type ReviewDraftRow } from '@/src/lib/db/drafts';
import { listStores, getActiveStoreId } from '@/src/lib/db/stores';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SeoSubnav } from '@/components/seo-subnav';
import { StatusBadge } from '@/components/status-badge';
import { operatorLoadError } from '@/lib/ui-copy';
import { jobStatusLabel, jobSubject, jobTypeLabel } from '@/lib/job-labels';
import { formatWhen, platformLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const PER_SITE_LIMIT = 50;

type SiteGroup = { id: string; name: string; platform: string; drafts: ReviewDraftRow[] };

export default async function Review({ searchParams }: { searchParams: Promise<{ success?: string; tab?: string }> }) {
  const params = await searchParams;
  const tab: 'waiting' | 'decided' = params.tab === 'decided' ? 'decided' : 'waiting';
  let groups: SiteGroup[] = [];
  let loadError: string | null = null;
  try {
    const [stores, activeId] = await Promise.all([listStores(), getActiveStoreId()]);
    const ordered = [...stores].sort((a: any, b: any) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
    groups = await Promise.all(
      ordered.map(async (store: any) => ({
        id: store.id,
        name: store.name,
        platform: (store.connector_type || store.platform) === 'wordpress' ? 'wordpress' : 'shopify',
        drafts: await listReviewDrafts(store.id, tab, PER_SITE_LIMIT),
      })),
    );
  } catch (e: any) {
    loadError = operatorLoadError(e.message) || 'Could not load drafts.';
  }
  const withDrafts = groups.filter((g) => g.drafts.length > 0);
  const total = withDrafts.reduce((n, g) => n + g.drafts.length, 0);

  return (
    <div className="cx-page">
      <PageHeader
        kicker="SEO"
        title="Review"
        lede="Drafts wait here for your decision. Nothing is published until you approve it."
        backHref="/seo"
      />
      <SeoSubnav />

      {params.success === 'decision-submitted' ? (
        <p className="cx-banner" role="status">
          Decision saved. Approved changes usually publish within a minute. Dismissed and snoozed drafts never change your site.
        </p>
      ) : null}
      {params.success === 'proposed' ? (
        <p className="cx-banner" role="status">Your proposed change is ready for review below.</p>
      ) : null}
      {loadError ? (
        <p className="cx-banner cx-banner-warn" role="status">Could not load drafts: {loadError}</p>
      ) : null}

      <nav className="cx-tabs" aria-label="Review status">
        <Link href="/review" aria-current={tab === 'waiting' ? 'page' : undefined}>
          Waiting{tab === 'waiting' ? ` (${total})` : ''}
        </Link>
        <Link href="/review?tab=decided" aria-current={tab === 'decided' ? 'page' : undefined}>
          Decided
        </Link>
      </nav>

      {!loadError && withDrafts.length === 0 ? (
        tab === 'waiting' ? (
          <EmptyState
            message="Nothing to review. Drafts appear here when you create content or draft a fix from Recommendations."
            action={
              <div className="cx-actions">
                <Link href="/seo/findings" className="btn-cta">Open recommendations</Link>
                <Link href="/seo/create" className="btn-secondary">Create content</Link>
              </div>
            }
          />
        ) : (
          <EmptyState message="No decided drafts yet." />
        )
      ) : null}

      {withDrafts.map((group) => (
        <section key={group.id} className="cx-panel">
          <h2 className="cx-review-site">
            <span>{group.name}</span>
            <span className="cx-review-site-meta">
              {platformLabel(group.platform)} · {group.drafts.length} {group.drafts.length === 1 ? 'draft' : 'drafts'}
            </span>
          </h2>
          <ul className="cx-review-list">
            {group.drafts.map((d) => {
              const subject = jobSubject(d.jobInput);
              return (
                <li key={d.id} className="cx-review-row">
                  <div className="cx-review-main">
                    <p className="cx-card-kicker">
                      <span>{jobTypeLabel(d.type)}</span>
                      {tab === 'decided' ? <StatusBadge status={d.jobStatus} label={jobStatusLabel(d.jobStatus)} /> : null}
                    </p>
                    <Link href={`/drafts/${d.id}`} className="cx-review-title">{d.title || 'Untitled draft'}</Link>
                    <p className="cx-card-meta">
                      {[subject && subject !== d.title ? `From “${subject}”` : null, d.handle ? `/${d.handle}` : null, formatWhen(d.createdAt)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Link href={`/drafts/${d.id}`} className={tab === 'waiting' ? 'btn-cta' : 'btn-secondary'}>
                    {tab === 'waiting' ? 'Review' : 'View'}
                  </Link>
                </li>
              );
            })}
          </ul>
          {group.drafts.length >= PER_SITE_LIMIT ? (
            <p className="cx-help">Showing the newest {PER_SITE_LIMIT}.</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
