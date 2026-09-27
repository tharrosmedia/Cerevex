import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckAdsButton } from '@/components/ads/check-ads-button';
import { SyncAdsButton } from '@/components/ads/sync-ads-button';
import { AdsFilters } from '@/components/ads/ads-filters';
import { ConnectEmpty } from '@/components/ads/connect-empty';
import { loadAdsCockpit } from '@/lib/ads-bff';
import { auditStatusLabel, platformLabel, shortWhen } from '@/lib/ads-copy';
import { auditPlatform, filterAudits, loadAccounts, parseAdsFilters } from '@/lib/ads-query';
import { resolveSiteAds } from '@/lib/ads-site';
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
  const [cockpit, siteAds] = await Promise.all([loadAdsCockpit(), resolveSiteAds()]);
  const selected = siteAds.client ?? undefined;
  const accounts = selected ? await loadAccounts([selected.id]) : [];
  const connected = accounts.filter((account) => account.connectionStatus === 'connected' || account.hasCredentials);
  const audits = filterAudits(cockpit.audits, { ...filters, client: selected?.id ?? '__no_site__' }, accounts);

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
        <p className="cx-banner cx-banner-warn" role="status">{cockpit.message}</p>
      ) : selected && connected.length === 0 ? (
        <ConnectEmpty
          title={`Connect ${siteAds.siteName ? `${siteAds.siteName}'s` : 'your'} ad accounts`}
          body="Checks need at least one connected Meta or Google Ads account."
          clientId={selected.id}
          allowMeta={adsCapabilityWritable(cockpit.workspace, 'connect.meta')}
          allowGoogle={adsCapabilityWritable(cockpit.workspace, 'connect.google')}
        />
      ) : (
        <>
          <AdsFilters
            action="/ads/audits"
            clients={[]}
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
              clientId={selected?.id}
              disabledReason={
                !adsCapabilityWritable(cockpit.workspace, 'audits')
                  ? 'Audits are off for this workspace.'
                  : !selected
                    ? siteAds.error || 'Add a store or site first.'
                    : undefined
              }
            />
            <SyncAdsButton
              accountIds={connected.map((account) => account.id)}
              disabledReason={
                !selected
                  ? siteAds.error || 'Add a store or site first.'
                  : connected.length === 0
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
