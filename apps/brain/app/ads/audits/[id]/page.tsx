import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AutoRefresh from '@/components/auto-refresh';
import { FindingCard } from '@/components/ads/finding-card';
import { RecommendationCard } from '@/components/ads/recommendation-card';
import { adsApi, type AdsAudit, type AdsFinding, type AdsSuggestion } from '@/lib/ads-bff';
import { auditStatusLabel, shortWhen } from '@/lib/ads-copy';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsAuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const { id } = await params;
  const bundle = await adsApi<{
    audit: AdsAudit;
    findings: AdsFinding[];
    recommendations: AdsSuggestion[];
  }>(`/audits/${id}`);

  if (!bundle.ok && bundle.reason === 'not_found') notFound();
  if (!bundle.ok) {
    return (
      <div className="cx-page">
        <p className="cx-kicker">Ads</p>
        <h1>Audit</h1>
        <p className="cx-help">{bundle.message}</p>
        <Link href="/ads/audits" className="btn-secondary">Back to audits</Link>
      </div>
    );
  }

  const { audit, findings, recommendations } = bundle.data;
  const pending = audit.status === 'queued' || audit.status === 'running';

  return (
    <div className="cx-page">
      {pending ? <AutoRefresh interval={2500} /> : null}
      <p className="cx-kicker">Ads · Audits</p>
      <h1>Check {auditStatusLabel(audit.status).toLowerCase()}</h1>
      <p className="cx-lede">
        Started {shortWhen(audit.startedAt ?? audit.createdAt)}
        {audit.finishedAt ? ` · finished ${shortWhen(audit.finishedAt)}` : ''}
      </p>

      <section className="cx-summary-grid">
        <article className="cx-card">
          <div className="cx-card-kicker">Status</div>
          <p className="cx-stat">{auditStatusLabel(audit.status)}</p>
        </article>
        <article className="cx-card">
          <div className="cx-card-kicker">Findings</div>
          <p className="cx-stat">{findings.length}</p>
        </article>
        <article className="cx-card">
          <div className="cx-card-kicker">Suggestions</div>
          <p className="cx-stat">{recommendations.length}</p>
        </article>
      </section>

      {pending ? <p className="cx-help" role="status">This check is still running. This page updates on its own.</p> : null}
      {audit.status === 'failed' ? (
        <p className="cx-banner cx-banner-warn">
          {typeof audit.summary.error === 'string' ? audit.summary.error : 'This check failed. Try Check ads again.'}
        </p>
      ) : null}

      <section>
        <h2>Findings</h2>
        {findings.length === 0 ? (
          <div className="cx-panel">
            <p className="cx-help">{pending ? 'Findings will show when the check finishes.' : 'No findings on this check.'}</p>
          </div>
        ) : (
          <div className="cx-card-grid">
            {findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} href={`/ads/findings/${finding.id}`} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Suggestions</h2>
        {recommendations.length === 0 ? (
          <div className="cx-panel">
            <p className="cx-help">{pending ? 'Suggestions will show when the check finishes.' : 'No suggestions yet — run an audit.'}</p>
          </div>
        ) : (
          <div className="cx-card-grid">
            {recommendations.map((suggestion) => (
              <RecommendationCard
                key={suggestion.id}
                suggestion={suggestion}
                href={`/ads/suggestions/${suggestion.id}`}
              />
            ))}
          </div>
        )}
      </section>

      <nav className="cx-inline-nav">
        <Link href="/ads/audits">All audits</Link>
        <Link href="/ads">Ads home</Link>
      </nav>
    </div>
  );
}
