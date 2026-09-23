import { redirect } from 'next/navigation';
import { AdsFilters } from '@/components/ads/ads-filters';
import { ConnectEmpty } from '@/components/ads/connect-empty';
import { RecommendationCard } from '@/components/ads/recommendation-card';
import { loadAdsCockpit } from '@/lib/ads-bff';
import { REC_INBOX_KINDS, rankSuggestions } from '@/lib/ads-copy';
import {
  clientName,
  filterSuggestions,
  loadAccounts,
  parseAdsFilters,
  pickDefaultClient,
} from '@/lib/ads-query';
import { adsCapabilityVisible } from '@/lib/ads-capabilities';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsSuggestionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string; platform?: string; status?: string; kind?: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const params = (await (searchParams ?? Promise.resolve({}))) as {
    client?: string;
    platform?: string;
    status?: string;
    kind?: string;
  };
  const filters = parseAdsFilters(params);
  const cockpit = await loadAdsCockpit();
  const selected = pickDefaultClient(cockpit.clients, null, filters.client);
  const accounts = await loadAccounts(cockpit.clients.map((client) => client.id));
  const suggestions = rankSuggestions(filterSuggestions(cockpit.suggestions, filters, accounts));

  if (!adsCapabilityVisible(cockpit.workspace, 'cockpit')) {
    return (
      <AdsCapabilityOff
        title="Suggestions are off"
        body="The ads cockpit is hidden for this workspace. Flip the cockpit flag to show suggestions again."
      />
    );
  }

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>Suggestions</h1>
      <p className="cx-lede">
        Inbox of budget shifts, creative tests, landing-page matches, and Grok alternatives. Numbers stay behind Details.
      </p>

      {!cockpit.ok ? (
        <ConnectEmpty title="No suggestions yet — run an audit." body={cockpit.message} clientId={selected?.id} />
      ) : (
        <AdsFilters
          action="/ads/suggestions"
          clients={cockpit.clients}
          value={filters}
          statusOptions={[
            { value: 'proposed', label: 'Open' },
            { value: 'authorized', label: 'Approved' },
            { value: 'denied', label: 'Dismissed' },
            { value: 'snoozed', label: 'Later' },
          ]}
          kindOptions={[...REC_INBOX_KINDS]}
        />
      )}

      {cockpit.ok && suggestions.length === 0 ? (
        <section className="cx-panel">
          <p className="cx-help">No suggestions yet — run an audit.</p>
        </section>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="cx-card-grid">
          {suggestions.map((suggestion) => (
            <RecommendationCard
              key={suggestion.id}
              suggestion={suggestion}
              clientName={clientName(cockpit.clients, suggestion.clientId)}
              href={`/ads/suggestions/${suggestion.id}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
