import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckAdsButton } from '@/components/ads/check-ads-button';
import { SyncAdsButton } from '@/components/ads/sync-ads-button';
import { AdsFilters } from '@/components/ads/ads-filters';
import { ConnectEmpty } from '@/components/ads/connect-empty';
import { RecommendationCard } from '@/components/ads/recommendation-card';
import { loadAdsCockpit } from '@/lib/ads-bff';
import { auditStatusLabel, formatMoney, rankSuggestions, shortWhen } from '@/lib/ads-copy';
import {
  clientName,
  filterAudits,
  filterSuggestions,
  lastCompletedAudit,
  loadAccounts,
  openSuggestionCount,
  parseAdsFilters,
} from '@/lib/ads-query';
import { adsCapabilityOn, adsCapabilityVisible, adsCapabilityWritable } from '@/lib/ads-capabilities';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { OfflineAttribution, type OfflineAttributionView } from '@/components/ads/offline-attribution';
import { LeadLifecycle, type LeadLifecycleView } from '@/components/ads/lead-lifecycle';
import { LpIntelligence, type LpIntelligenceView } from '@/components/ads/lp-intelligence';
import { SeasonalityCalendar, type SeasonalityView } from '@/components/ads/seasonality-calendar';
import { OwnerWeeklyNarrative, type WeeklyNarrativeView } from '@/components/ads/owner-weekly-narrative';
import { adsApi } from '@/lib/ads-bff';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';
import { resolveSiteAds } from '@/lib/ads-site';
import { ConnectButtons } from '@/components/ads/connect-buttons';

export const dynamic = 'force-dynamic';

type CockpitParams = {
  platform?: string;
  status?: string;
  connect_error?: string;
  connected?: string;
  count?: string;
  oauth_error?: string;
};

export default async function AdsCockpitPage({
  searchParams,
}: {
  searchParams?: Promise<CockpitParams>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) {
    redirect('/onboarding');
  }

  const params = (await (searchParams ?? Promise.resolve({}))) as CockpitParams;
  const filters = parseAdsFilters(params);
  const [cockpit, siteAds] = await Promise.all([loadAdsCockpit(), resolveSiteAds()]);
  const storeName = siteAds.siteName;
  const selectedClient = siteAds.client ?? undefined;
  const accounts = selectedClient ? await loadAccounts([selectedClient.id]) : [];
  const siteFilter = { ...filters, client: selectedClient?.id ?? '__no_site__' };
  const audits = filterAudits(cockpit.audits, siteFilter, accounts);
  const suggestions = rankSuggestions(
    filterSuggestions(cockpit.suggestions, { ...siteFilter, status: filters.status }, accounts),
  );
  const lastAudit = lastCompletedAudit(audits);
  const openCount = openSuggestionCount(suggestions);
  const connected = accounts.filter((account) => account.connectionStatus === 'connected' || account.hasCredentials);
  const spend = lastAudit ? formatMoney(typeof lastAudit.summary.spend30dUsd === 'string' ? lastAudit.summary.spend30dUsd : null) : null;
  const canCheck = Boolean(selectedClient) && connected.length > 0;
  const cockpitOn = adsCapabilityOn(cockpit.workspace, 'cockpit');
  const cockpitVisible = adsCapabilityVisible(cockpit.workspace, 'cockpit');
  const auditsOn = adsCapabilityWritable(cockpit.workspace, 'audits');
  const connectMeta = adsCapabilityWritable(cockpit.workspace, 'connect.meta');
  const connectGoogle = adsCapabilityWritable(cockpit.workspace, 'connect.google');
  const callrailVisible = adsCapabilityVisible(cockpit.workspace, 'm52.callrail_connect');
  const bundledVisible = adsCapabilityVisible(cockpit.workspace, 'm52.bundled_call_tracking');
  const crmVisible = adsCapabilityVisible(cockpit.workspace, 'm52.crm_join');
  const lifecycleVisible = adsCapabilityVisible(cockpit.workspace, 'm52.lead_lifecycle');
  const bookedSignalVisible = adsCapabilityVisible(cockpit.workspace, 'm52.booked_job_signal');
  const clarityVisible = adsCapabilityVisible(cockpit.workspace, 'm52.clarity_connect');
  const lpVisible = adsCapabilityVisible(cockpit.workspace, 'm52.lp_intelligence');
  const seasonalityVisible = adsCapabilityVisible(cockpit.workspace, 'm52.seasonality_calendar');
  const narrativeVisible = adsCapabilityVisible(cockpit.workspace, 'm52.owner_weekly_narrative');
  let offline: OfflineAttributionView | null = null;
  let lifecycle: LeadLifecycleView | null = null;
  let lpIntel: LpIntelligenceView | null = null;
  let planning: { seasonality: SeasonalityView | null; narrative: WeeklyNarrativeView | null } | null = null;
  if ((callrailVisible || bundledVisible || crmVisible) && selectedClient) {
    const result = await adsApi<OfflineAttributionView>(`/clients/${selectedClient.id}/offline-attribution`);
    offline = result.ok ? result.data : null;
  }
  if ((lifecycleVisible || crmVisible) && selectedClient) {
    const result = await adsApi<LeadLifecycleView>(`/clients/${selectedClient.id}/lead-lifecycle`);
    lifecycle = result.ok ? result.data : null;
  }
  if ((clarityVisible || lpVisible) && selectedClient) {
    const result = await adsApi<LpIntelligenceView>(`/clients/${selectedClient.id}/lp-intelligence`);
    lpIntel = result.ok ? result.data : null;
  }
  if ((seasonalityVisible || narrativeVisible) && selectedClient) {
    const result = await adsApi<{
      visible: boolean;
      seasonality: SeasonalityView | null;
      narrative: WeeklyNarrativeView | null;
    }>(`/clients/${selectedClient.id}/planning`);
    planning = result.ok && result.data.visible ? result.data : null;
  }

  if (!cockpitVisible) {
    return (
      <AdsCapabilityOff
        title="Ads cockpit is off"
        body="This workspace hid the ads cockpit. Existing data is still readable. Flip the cockpit flag in Settings to show it again."
      />
    );
  }

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>Ads</h1>
      <p className="cx-lede">
        See what a check found and what Cerevex suggests. Open a suggestion to Approve, Deny, or Snooze.
      </p>

      {!cockpitOn ? (
        <p className="cx-banner">Cockpit is recommend-only for this workspace. Nothing new will apply from here.</p>
      ) : null}
      {filters.notice ? <p className="cx-banner" role="status">{filters.notice}</p> : null}
      {cockpit.workspace?.applyKillSwitch ? (
        <p className="cx-banner cx-banner-warn">Ads are paused. Approve cannot apply until the pause is off.</p>
      ) : (
        <p className="cx-banner">Approve can change live ads. Deny and Snooze never write platforms.</p>
      )}

      {!cockpit.ok ? (
        <p className="cx-banner cx-banner-warn" role="status">
          {cockpit.message || 'The ads service is not reachable right now.'}
        </p>
      ) : !selectedClient ? (
        <section className="cx-panel">
          <h2>Connect ad accounts</h2>
          <p className="cx-help">{siteAds.error || 'Could not load ad accounts for this site.'}</p>
          {!siteAds.siteId ? (
            <div className="cx-actions">
              <Link href="/stores" className="btn-cta">Add a store or site</Link>
            </div>
          ) : null}
        </section>
      ) : connected.length === 0 ? (
        <ConnectEmpty
          title={`Connect ${storeName ? `${storeName}'s` : 'your'} ad accounts`}
          body="Connect Meta or Google Ads. You'll choose which ad accounts belong to this site."
          clientId={selectedClient.id}
          showCheckHint
          allowMeta={connectMeta}
          allowGoogle={connectGoogle}
        />
      ) : (
        <section className="cx-panel">
          <h2>Ad accounts for {storeName || 'this site'}</h2>
          <ul className="cx-status-list">
            {connected.map((account) => (
              <li key={account.id}>
                <span>{account.platform === 'google' ? 'Google Ads' : 'Meta'} · {account.displayName || account.externalId}</span>
                <span>{account.lastSyncAt ? `Synced ${shortWhen(account.lastSyncAt)}` : 'Not synced yet'}</span>
              </li>
            ))}
          </ul>
          <ConnectButtons clientId={selectedClient.id} allowMeta={connectMeta} allowGoogle={connectGoogle} addMore />
        </section>
      )}

      {selectedClient ? (
        <AdsFilters
          action="/ads"
          clients={[]}
          value={filters}
          statusOptions={[]}
        />
      ) : null}

      <section className="cx-summary-grid">
        <article className="cx-card">
          <div className="cx-card-kicker">Last check</div>
          <p className="cx-stat">{lastAudit ? auditStatusLabel(lastAudit.status) : 'None yet'}</p>
          <p className="cx-help">{lastAudit ? shortWhen(lastAudit.finishedAt ?? lastAudit.createdAt) : 'Run a check to see findings.'}</p>
        </article>
        <article className="cx-card">
          <div className="cx-card-kicker">Suggestions</div>
          <p className="cx-stat">{openCount}</p>
          <p className="cx-help">{openCount === 1 ? 'Open suggestion' : 'Open suggestions'}</p>
        </article>
        {spend ? (
          <article className="cx-card">
            <div className="cx-card-kicker">Spend</div>
            <p className="cx-stat">{spend}</p>
            <p className="cx-help">From the last check</p>
          </article>
        ) : null}
      </section>

      {offline?.visible ? <OfflineAttribution client={selectedClient ?? null} view={offline} /> : null}
      {lifecycle?.visible && lifecycleVisible ? <LeadLifecycle client={selectedClient ?? null} view={lifecycle} /> : null}
      {lpIntel?.visible ? <LpIntelligence client={selectedClient ?? null} view={lpIntel} /> : null}
      {seasonalityVisible && planning?.seasonality ? (
        <SeasonalityCalendar client={selectedClient ?? null} view={planning.seasonality} />
      ) : null}
      {narrativeVisible && planning?.narrative ? (
        <OwnerWeeklyNarrative client={selectedClient ?? null} view={planning.narrative} />
      ) : null}

      <section className="cx-panel">
        <h2>Check ads</h2>
        <p className="cx-help">Starts a check and keeps this page usable while it runs.</p>
        <CheckAdsButton
          clientId={selectedClient?.id}
          disabledReason={
            !auditsOn
              ? 'Audits are off for this workspace.'
              : !selectedClient
                ? 'Add a store or site first.'
                : connected.length === 0
                  ? 'Connect Meta or Google first.'
                  : undefined
          }
        />
        <SyncAdsButton
          accountIds={connected.map((account) => account.id)}
          disabledReason={
            !selectedClient
              ? 'Add a store or site first.'
              : connected.length === 0
                ? 'Connect Meta or Google first.'
                : undefined
          }
        />
        {!canCheck ? null : (
          <p className="cx-help">
            Recent checks live under <Link href="/ads/audits">Audits</Link>.
          </p>
        )}
      </section>

      <section>
        <div className="cx-section-head">
          <h2>Suggestions</h2>
          <Link href="/ads/suggestions" className="btn-secondary">All suggestions</Link>
        </div>
        {suggestions.length === 0 ? (
          <div className="cx-panel">
            <p className="cx-help">No suggestions yet. Run a check to get some.</p>
          </div>
        ) : (
          <div className="cx-card-grid">
            {suggestions.slice(0, 6).map((suggestion) => (
              <RecommendationCard
                key={suggestion.id}
                suggestion={suggestion}
                clientName={clientName(cockpit.clients, suggestion.clientId)}
                href={`/ads/suggestions/${suggestion.id}`}
              />
            ))}
          </div>
        )}
      </section>

      <nav className="cx-inline-nav" aria-label="Ads sections">
        <Link href="/ads/audits">Audits</Link>
        <Link href="/ads/suggestions">Suggestions</Link>
        <Link href="/ads/creatives">Creatives</Link>
        <Link href="/ads/funnel">Funnel</Link>
        <Link href="/settings#modules">Modules</Link>
        {callrailVisible || crmVisible || lifecycleVisible || bookedSignalVisible ? <Link href="/settings#callrail">CallRail</Link> : null}
        {seasonalityVisible ? <Link href="/settings#seasonality">Seasonality</Link> : null}
      </nav>
    </div>
  );
}
