import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RecommendationActions } from '@/components/ads/recommendation-actions';
import { RecommendationCard } from '@/components/ads/recommendation-card';
import { canApproveWithApply, defaultCapabilityFlags, isApplyEnabled } from '@cerevex/contracts';
import { adsApi, type AdsClient, type AdsSuggestion } from '@/lib/ads-bff';
import { applyStatusLabel } from '@/lib/ads-copy';
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
  const result = await adsApi<{
    recommendation: AdsSuggestion;
    applyJob?: { status: string; error?: string | null; response?: Record<string, unknown> | null } | null;
    client?: { id: string; name: string } | null;
    adAccount?: { frozen?: boolean; platform?: string } | null;
    canApprove?: boolean;
    applyGate?: { allowed: boolean; blocked: string | null };
  }>(`/recommendations/${id}`);
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
  const workspace = await adsApi<{
    workspace: { applyKillSwitch: boolean; capabilities?: import('@cerevex/contracts').CapabilityFlags } | null;
    canApprove?: boolean;
  }>('/workspace');
  const killSwitchOn = Boolean(workspace.ok && workspace.data.workspace?.applyKillSwitch);
  const flags = workspace.ok
    ? workspace.data.workspace?.capabilities ?? defaultCapabilityFlags()
    : defaultCapabilityFlags();
  const applyOn = workspace.ok ? isApplyEnabled(flags) : true;
  const operatorCanApprove = Boolean(result.data.canApprove ?? (workspace.ok && workspace.data.canApprove));
  const canApprove = workspace.ok ? canApproveWithApply(operatorCanApprove, flags) : operatorCanApprove;

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads · Suggestions</p>
      <h1>Suggestion</h1>
      <p className="cx-lede">
        Approve applies this change. Deny and Snooze never write Meta or Google.
      </p>
      {suggestion.type === 'lp_congruence' ? (
        <p className="cx-banner">
          Landing-page match is recommend-only. Cerevex cannot change the website in this slice — Site apply later.
        </p>
      ) : null}
      {suggestion.type === 'create_alternative' ? (
        <p className="cx-banner">Grok already generated this idea. Approve creates the ad. Generate did not write live.</p>
      ) : null}
      {killSwitchOn ? (
        <p className="cx-banner cx-banner-warn">Ads are paused. Approve cannot apply until the pause is off.</p>
      ) : null}
      {!applyOn ? (
        <p className="cx-banner">Apply is off for this workspace. Deny and Snooze still work. Nothing will write platforms.</p>
      ) : null}
      <RecommendationCard
        suggestion={suggestion}
        clientName={result.data.client?.name ?? (client?.ok ? client.data.client.name : undefined)}
      />
      {result.data.applyJob ? (
        <section className="cx-panel">
          <p>Apply status: {applyStatusLabel(result.data.applyJob.status)}</p>
          {result.data.applyJob.error ? <p className="cx-help">{result.data.applyJob.error}</p> : null}
          {result.data.applyJob.response ? (
            <details>
              <summary>Details</summary>
              <pre>{JSON.stringify(result.data.applyJob.response, null, 2)}</pre>
            </details>
          ) : null}
        </section>
      ) : null}
      <RecommendationActions
        suggestion={suggestion}
        clientName={result.data.client?.name ?? (client?.ok ? client.data.client.name : undefined)}
        canApprove={canApprove}
        killSwitchOn={killSwitchOn}
        frozen={Boolean(result.data.adAccount?.frozen)}
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
