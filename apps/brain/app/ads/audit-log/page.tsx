import { redirect } from 'next/navigation';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { adsApi, loadAdsCockpit } from '@/lib/ads-bff';
import { adsCapabilityVisible } from '@/lib/ads-capabilities';
import { resolveSiteAds } from '@/lib/ads-site';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

type AuditEvent = {
  id: string;
  storeId: string | null;
  approver: string | null;
  module: string;
  action: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type AuditList = {
  rows: AuditEvent[];
  nextCursor: string | null;
  truncated: boolean;
};

const ACTION_LABEL: Record<string, string> = {
  rec_created: 'Recommendation created',
  approved: 'Approved',
  rejected: 'Rejected',
  applied: 'Applied',
  mark_done: 'Marked done',
  rolled_back: 'Rolled back',
  prompt_layer_approved: 'Prompt layer approved',
  prompt_layer_rolled_back: 'Prompt layer rolled back',
  role_changed: 'Role changed',
};

function labelFor(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: Promise<{
    store?: string;
    from?: string;
    to?: string;
    approver?: string;
    module?: string;
    action?: string;
    cursor?: string;
  }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const params = (await (searchParams ?? Promise.resolve({}))) as {
    store?: string;
    from?: string;
    to?: string;
    approver?: string;
    module?: string;
    action?: string;
    cursor?: string;
  };
  const [cockpit, siteAds] = await Promise.all([loadAdsCockpit(), resolveSiteAds()]);
  if (!adsCapabilityVisible(cockpit.ok ? cockpit.workspace : null, 'cockpit')) {
    return (
      <AdsCapabilityOff
        title="Audit log is off"
        body="This workspace hid the cockpit. The log stays in the API. Flip the cockpit flag to show it again."
      />
    );
  }

  const query = new URLSearchParams();
  for (const key of ['store', 'from', 'to', 'approver', 'module', 'action', 'cursor'] as const) {
    if (params[key]) query.set(key, params[key]);
  }
  const exportQuery = new URLSearchParams(query);
  exportQuery.delete('cursor');

  const client = siteAds.client;
  const listed = client
    ? await adsApi<AuditList>(`/clients/${client.id}/audit-log?${query.toString()}`)
    : null;

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>Audit log</h1>
      <p className="cx-lede">
        Who approved a change, who applied it, and what it looked like before and after.
        These rows stay. Nobody can edit or delete them, including an admin.
      </p>

      {!client ? (
        <p className="cx-banner cx-banner-warn" role="status">
          {siteAds.error || 'Add a store or site first. The log is kept per client.'}
        </p>
      ) : (
        <>
          <form className="cx-panel" action="/ads/audit-log" method="get">
            <label>
              Store
              <input name="store" defaultValue={params.store ?? ''} placeholder="Optional store id" />
            </label>
            <label>
              From
              <input name="from" type="date" defaultValue={params.from ?? ''} />
            </label>
            <label>
              To
              <input name="to" type="date" defaultValue={params.to ?? ''} />
            </label>
            <label>
              Approver
              <input name="approver" defaultValue={params.approver ?? ''} placeholder="Name" />
            </label>
            <label>
              Module
              <input name="module" defaultValue={params.module ?? ''} placeholder="ads, roles, prompt-layer" />
            </label>
            <label>
              Action
              <select name="action" defaultValue={params.action ?? ''}>
                <option value="">Any</option>
                {Object.entries(ACTION_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-cta" type="submit">
              Show these rows
            </button>
            <a className="btn-cta" href={`/ads/audit-log/export?format=csv&${exportQuery.toString()}`}>
              Download CSV
            </a>
            <a className="btn-secondary" href={`/ads/audit-log/export?format=json&${exportQuery.toString()}`}>
              Download JSON
            </a>
          </form>

          {listed && !listed.ok ? (
            <p className="cx-banner cx-banner-warn" role="status">{listed.message}</p>
          ) : null}

          {listed && listed.ok && listed.data.rows.length === 0 ? (
            <p>Nothing matches these filters yet.</p>
          ) : null}

          {listed && listed.ok && listed.data.rows.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What happened</th>
                  <th>Approver</th>
                  <th>Module</th>
                  <th>Store</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {listed.data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{when(row.createdAt)}</td>
                    <td>{labelFor(row.action)}</td>
                    <td>{row.approver || 'System'}</td>
                    <td>{row.module}</td>
                    <td>{row.storeId || 'All stores'}</td>
                    <td>
                      <details>
                        <summary>Details</summary>
                        <pre>{JSON.stringify(row.payload, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {listed && listed.ok && listed.data.nextCursor ? (
            <p>
              <a href={`/ads/audit-log?${new URLSearchParams({ ...Object.fromEntries(exportQuery), cursor: listed.data.nextCursor }).toString()}`}>
                Older rows
              </a>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
