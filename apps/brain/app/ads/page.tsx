import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckAdsButton } from '@/components/ads/check-ads-button';
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
  pickDefaultClient,
} from '@/lib/ads-query';
import { adsCapabilityOn, adsCapabilityVisible, adsCapabilityWritable } from '@/lib/ads-capabilities';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';
import { getActiveStoreId, listStores } from '@/src/lib/db/stores';

export const dynamic = 'force-dynamic';

export default async function AdsCockpitPage({
  searchParams,
}: {
  searchParams?: Promise<{
    client?: string;
    platform?: string;
    status?: string;
    connect_error?: string;
    connected?: string;
    oauth_error?: string;
  }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) {
    redirect('/onboarding');
  }

  const params = (await (searchParams ?? Promise.resolve({}))) as {
    client?: string;
    platform?: string;
    status?: string;
    connect_error?: string;
    connected?: string;
    oauth_error?: string;
  };
  const filters = parseAdsFilters(params);
  const cockpit = await loadAdsCockpit();

  let storeName: string | null = null;
  try {
    const storeId = await getActiveStoreId();
    const stores = (await listStores()) as Array<{ id?: string; name?: string }>;
    storeName = stores.find((store) => store.id === storeId)?.name ?? null;
  } catch {}

  const selectedClient = pickDefaultClient(cockpit.clients, storeName, filters.client);
  const accounts = await loadAccounts(cockpit.clients.map((client) => client.id));
  const audits = filterAudits(cockpit.audits, { ...filters, client: selectedClient?.id ?? filters.client }, accounts);
  const suggestions = rankSuggestions(
    filterSuggestions(cockpit.suggestions, { ...filters, client: selectedClient?.id ?? filters.client, status: filters.status }, accounts),
  );
  const lastAudit = lastCompletedAudit(audits);
  const openCount = openSuggestionCount(suggestions);
  const connected = accounts.filter((account) => account.connectionStatus === 'connected' || account.hasCredentials);
  const spend = lastAudit ? formatMoney(typeof lastAudit.summary.spend30dUsd === 'string' ? lastAudit.summary.spend30dUsd : null) : null;
  const hasClients = cockpit.clients.length > 0;
  const canCheck = Boolean(selectedClient) && connected.length > 0;
  const cockpitOn = adsCapabilityOn(cockpit.workspace, 'cockpit');
  const cockpitVisible = adsCapabilityVisible(cockpit.workspace, 'cockpit');
  const auditsOn = adsCapabilityWritable(cockpit.workspace, 'audits');
  const connectMeta = adsCapabilityWritable(cockpit.workspace, 'connect.meta');
  const connectGoogle = adsCapabilityWritable(cockpit.workspace, 'connect.google');

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
        <ConnectEmpty
          title="Connect Meta to run your first check."
          body={cockpit.message || 'Ads checks are not connected yet. No sample data is shown.'}
          clientId={selectedClient?.id}
          showCheckHint
          allowMeta={connectMeta}
          allowGoogle={connectGoogle}
        />
      ) : !hasClients ? (
        <ConnectEmpty
          title="No clients yet."
          body="Add a client before you can connect Meta or Google and run a check."
        />
      ) : connected.length === 0 ? (
        <ConnectEmpty
          title="Connect Meta to run your first check."
          body="No ad accounts are connected. Cerevex will not invent spend or suggestions."
          clientId={selectedClient?.id}
          showCheckHint
          allowMeta={connectMeta}
          allowGoogle={connectGoogle}
        />
      ) : null}

      {hasClients ? (
        <AdsFilters
          action="/ads"
          clients={cockpit.clients}
          value={{ ...filters, client: selectedClient?.id }}
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
        {selectedClient ? (
          <article className="cx-card">
            <div className="cx-card-kicker">Client</div>
            <p className="cx-stat cx-stat-text">{selectedClient.name}</p>
            <p className="cx-help">{storeName ? `Store: ${storeName}` : 'Use filters to switch clients.'}</p>
          </article>
        ) : null}
      </section>

      <section className="cx-panel">
        <h2>Check ads</h2>
        <p className="cx-help">Starts a check and keeps this page usable while it runs.</p>
        <CheckAdsButton
          clientId={selectedClient?.id}
          disabledReason={
            !auditsOn
              ? 'Audits are off for this workspace.'
              : !selectedClient
                ? 'Choose a client to run a check.'
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
            <p className="cx-help">No suggestions yet — run an audit.</p>
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
      </nav>
    </div>
  );
}
