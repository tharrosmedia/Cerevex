import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RecommendationCard } from '@/components/ads/recommendation-card';
import { adsApi, type AdsClient, type AdsSuggestion } from '@/lib/ads-bff';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsSuggestionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const { id } = await params;
  const result = await adsApi<{ recommendation: AdsSuggestion }>(`/recommendations/${id}`);
  if (!result.ok && result.reason === 'not_found') notFound();
  if (!result.ok) {
    return (
      <div className="cx-page">
        <p className="cx-kicker">Ads · Suggestions</p>
        <h1>Suggestion</h1>
        <p className="cx-help">{result.message}</p>
        <Link href="/ads/suggestions" className="btn-secondary">Back to suggestions</Link>
      </div>
    );
  }

  const suggestion = result.data.recommendation;
  const client = suggestion.clientId
    ? await adsApi<{ client: AdsClient }>(`/clients/${suggestion.clientId}`)
    : null;

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads · Suggestions</p>
      <h1>Suggestion</h1>
      <p className="cx-lede">Read only. There is no approve or apply control in this slice.</p>
      <RecommendationCard
        suggestion={suggestion}
        clientName={client?.ok ? client.data.client.name : undefined}
      />
      <nav className="cx-inline-nav">
        {suggestion.evidence && typeof suggestion.evidence.auditRunId === 'string' ? (
          <Link href={`/ads/audits/${suggestion.evidence.auditRunId}`}>Related audit</Link>
        ) : null}
        <Link href="/ads/suggestions">All suggestions</Link>
        <Link href="/ads">Ads home</Link>
      </nav>
    </div>
  );
}
