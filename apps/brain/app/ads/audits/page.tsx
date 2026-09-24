import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckAdsButton } from '@/components/ads/check-ads-button';
import { SyncAdsButton } from '@/components/ads/sync-ads-button';
import { AdsFilters } from '@/components/ads/ads-filters';
import { ConnectEmpty } from '@/components/ads/connect-empty';
import { loadAdsCockpit } from '@/lib/ads-bff';
import { auditStatusLabel, platformLabel, shortWhen } from '@/lib/ads-copy';
import {
  auditPlatform,
  clientName,
  filterAudits,
  loadAccounts,
  parseAdsFilters,
  pickDefaultClient,
} from '@/lib/ads-query';
import { adsCapabilityVisible, adsCapabilityWritable } from '@/lib/ads-capabilities';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsAuditsPage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string; platform?: string; status?: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const params = (await (searchParams ?? Promise.resolve({}))) as {
    client?: string;
    platform?: string;
    status?: string;
  };
  const filters = parseAdsFilters(params);
  const cockpit = await loadAdsCockpit();
  const selected = pickDefaultClient(cockpit.clients, null, filters.client);
  const accounts = await loadAccounts(cockpit.clients.map((client) => client.id));
  const audits = filterAudits(cockpit.audits, filters, accounts);

  if (!adsCapabilityVisible(cockpit.workspace, 'audits')) {
    return (
      <AdsCapabilityOff
        title="Audits are off"
        body="This workspace hid audits. Existing checks stay in the API. Flip the audits flag to show them again."
      />
    );
  }

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>Audits</h1>
      <p className="cx-lede">Every check and how it finished. Open one to see findings.</p>

      {!cockpit.ok ? (
        <ConnectEmpty
          title="Connect Meta to run your first check."
          body={cockpit.message}
          clientId={selected?.id}
          allowMeta={adsCapabilityWritable(cockpit.workspace, 'connect.meta')}
          allowGoogle={adsCapabilityWritable(cockpit.workspace, 'connect.google')}
        />
      ) : (
        <>
          <AdsFilters
            action="/ads/audits"
            clients={cockpit.clients}
            value={filters}
            statusOptions={[
              { value: 'queued', label: 'Queued' },
              { value: 'running', label: 'Running' },
              { value: 'completed', label: 'Done' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
          <section className="cx-panel">
            <CheckAdsButton
              clientId={selected?.id ?? (filters.client || undefined)}
              disabledReason={
                !adsCapabilityWritable(cockpit.workspace, 'audits')
                  ? 'Audits are off for this workspace.'
                  : !selected && !filters.client
                    ? 'Choose a client to run a check.'
                    : undefined
              }
            />
            <SyncAdsButton
              accountIds={accounts
                .filter((account) => account.clientId === (selected?.id ?? filters.client) && (account.connectionStatus === 'connected' || account.hasCredentials))
                .map((account) => account.id)}
              disabledReason={
                !selected && !filters.client
                  ? 'Choose a client to sync.'
                  : accounts.filter((account) => account.connectionStatus === 'connected' || account.hasCredentials).length === 0
                    ? 'Connect Meta or Google first.'
                    : undefined
              }
            />
          </section>
        </>
      )}

      {cockpit.ok && audits.length === 0 ? (
        <section className="cx-panel">
          <p className="cx-help">No checks yet — run a check to see findings.</p>
        </section>
      ) : null}

      {audits.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Client</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Findings</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {audits.map((audit) => {
                const findings = typeof audit.summary.findingCount === 'number' ? audit.summary.findingCount : null;
                return (
                  <tr key={audit.id}>
                    <td data-label="When">{shortWhen(audit.createdAt)}</td>
                    <td data-label="Client">{clientName(cockpit.clients, audit.clientId)}</td>
                    <td data-label="Platform">{platformLabel(auditPlatform(audit, accounts)) || '—'}</td>
                    <td data-label="Status">{auditStatusLabel(audit.status)}</td>
                    <td data-label="Findings">{findings ?? '—'}</td>
                    <td data-label="Open">
                      <Link href={`/ads/audits/${audit.id}`}>Open</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
