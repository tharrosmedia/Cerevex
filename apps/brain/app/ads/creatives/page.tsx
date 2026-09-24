import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GrokAdaptForm } from '@/components/ads/grok-adapt-form';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { ConnectEmpty } from '@/components/ads/connect-empty';
import { SyncAdsButton } from '@/components/ads/sync-ads-button';
import { adsApi, loadAdsCockpit } from '@/lib/ads-bff';
import { adsCapabilityVisible, adsCapabilityWritable } from '@/lib/ads-capabilities';
import { formatMoney, platformLabel } from '@/lib/ads-copy';
import { loadAccounts, parseAdsFilters, pickDefaultClient } from '@/lib/ads-query';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

type CreativeRow = {
  id: string;
  name: string;
  platform: 'meta' | 'google';
  status: string;
  clientId: string;
  creative: {
    headline: string | null;
    body: string | null;
    imageUrl: string | null;
    landingPageUrl: string | null;
    offer: string | null;
  };
  sentiment: { label: string; why: string };
  metrics: { window: string; spendUsd: string; impressions: number; clicks: number; conversions: string }[];
};

export default async function AdsCreativesPage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const params = (await (searchParams ?? Promise.resolve({}))) as { client?: string };
  const filters = parseAdsFilters(params);
  const cockpit = await loadAdsCockpit();
  const selected = pickDefaultClient(cockpit.clients, null, filters.client);
  const grokVisible = adsCapabilityVisible(cockpit.workspace, 'm51.grok_creatives');
  const lpVisible = adsCapabilityVisible(cockpit.workspace, 'm51.lp_congruence');
  if (!grokVisible && !lpVisible) {
    return (
      <AdsCapabilityOff
        title="Creatives are off"
        body="Turn on Grok creatives or Landing-page match in Settings → Capabilities to see ads and adapt them."
      />
    );
  }

  const accounts = selected ? await loadAccounts([selected.id]) : [];
  const connected = accounts.filter((account) => account.connectionStatus === 'connected' || account.hasCredentials);
  const bundle = selected
    ? await adsApi<{ creatives: CreativeRow[]; analysis: { why?: string } | null }>(`/clients/${selected.id}/creatives`)
    : null;
  const creatives = bundle?.ok ? bundle.data.creatives : [];
  const analysis = bundle?.ok ? bundle.data.analysis : null;
  const canGenerate = adsCapabilityWritable(cockpit.workspace, 'm51.grok_creatives');

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads · Creatives</p>
      <h1>Creatives</h1>
      <p className="cx-lede">
        See what is running on Meta and Google. Compare ads in a group, then adapt a winner for the other platform.
      </p>
      {!selected ? (
        <ConnectEmpty title="Choose a client to see ads." body="Creatives load from synced Meta and Google accounts." />
      ) : creatives.length === 0 ? (
        <section className="cx-panel">
          <p className="cx-help">No ads synced yet. Connect Meta or Google, sync, then come back.</p>
          <SyncAdsButton
            accountIds={connected.map((account) => account.id)}
            disabledReason={
              !selected
                ? 'Choose a client to sync.'
                : connected.length === 0
                  ? 'Connect Meta or Google first.'
                  : undefined
            }
          />
        </section>
      ) : (
        <>
          {analysis?.why ? (
            <section className="cx-panel">
              <h2>What is winning</h2>
              <p>{analysis.why}</p>
              <details className="cx-details">
                <summary>Details</summary>
                <p>Lift uses synced impressions and clicks only. Cerevex does not invent missing numbers.</p>
              </details>
            </section>
          ) : null}
          <div className="cx-card-grid">
            {creatives.map((ad) => {
              const m30 = ad.metrics.find((row) => row.window === '30d') ?? ad.metrics[0];
              return (
                <article key={ad.id} className="cx-card">
                  <div className="cx-card-kicker">
                    <span>{platformLabel(ad.platform)}</span>
                    <span>{ad.status}</span>
                  </div>
                  {ad.creative.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ad.creative.imageUrl} alt="" width={320} height={320} style={{ width: '100%', height: 'auto', background: '#fff' }} />
                  ) : (
                    <p className="cx-help">No image synced for this ad.</p>
                  )}
                  <h3 className="cx-card-title">{ad.creative.headline ?? ad.name}</h3>
                  <p className="cx-card-why">{ad.creative.body ?? 'No body copy synced.'}</p>
                  <p className="cx-help">Tone: {ad.sentiment.why}</p>
                  <details className="cx-details">
                    <summary>Details</summary>
                    <ul>
                      {m30 ? (
                        <>
                          <li>Spend (30 days): {formatMoney(m30.spendUsd) ?? m30.spendUsd}</li>
                          <li>Views: {m30.impressions}</li>
                          <li>Clicks: {m30.clicks}</li>
                          <li>Leads: {m30.conversions}</li>
                        </>
                      ) : (
                        <li>No metrics synced for this ad.</li>
                      )}
                      {ad.creative.offer ? <li>Offer: {ad.creative.offer}</li> : null}
                      {ad.creative.landingPageUrl ? <li>Page: {ad.creative.landingPageUrl}</li> : null}
                    </ul>
                  </details>
                  <GrokAdaptForm
                    clientId={ad.clientId}
                    entityId={ad.id}
                    sourcePlatform={ad.platform}
                    canGenerate={canGenerate}
                  />
                </article>
              );
            })}
          </div>
        </>
      )}
      <nav className="cx-inline-nav">
        <Link href="/ads/suggestions">Suggestions</Link>
        <Link href="/ads/leads">Brainstorm</Link>
        <Link href="/ads">Ads home</Link>
      </nav>
    </div>
  );
}
