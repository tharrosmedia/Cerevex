import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FindingCard } from '@/components/ads/finding-card';
import { adsApi, type AdsFinding } from '@/lib/ads-bff';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsFindingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const { id } = await params;
  const result = await adsApi<{ finding: AdsFinding }>(`/findings/${id}`);
  if (!result.ok && result.reason === 'not_found') notFound();
  if (!result.ok) {
    return (
      <div className="cx-page">
        <p className="cx-kicker">Ads · Findings</p>
        <h1>Finding</h1>
        <p className="cx-help">{result.message}</p>
        <Link href="/ads/audits" className="btn-secondary">Back to audits</Link>
      </div>
    );
  }

  const finding = result.data.finding;

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads · Findings</p>
      <h1>Finding</h1>
      <FindingCard finding={finding} />
      <nav className="cx-inline-nav">
        {finding.auditRunId ? <Link href={`/ads/audits/${finding.auditRunId}`}>Related audit</Link> : null}
        <Link href="/ads/audits">All audits</Link>
        <Link href="/ads">Ads home</Link>
      </nav>
    </div>
  );
}
