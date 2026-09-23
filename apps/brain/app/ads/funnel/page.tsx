import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FunnelConnectForm } from '@/components/ads/funnel-connect-form';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { adsApi, loadAdsCockpit } from '@/lib/ads-bff';
import { adsCapabilityVisible, adsCapabilityWritable } from '@/lib/ads-capabilities';
import { pickDefaultClient } from '@/lib/ads-query';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsFunnelPage() {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const cockpit = await loadAdsCockpit();
  if (!adsCapabilityVisible(cockpit.workspace, 'm51.ga4_connect')) {
    return (
      <AdsCapabilityOff
        title="Funnel is off"
        body="Turn on Funnel (GA4 + pixel) in Settings → Capabilities to connect Google Analytics or the Cerevex pixel."
      />
    );
  }

  const selected = pickDefaultClient(cockpit.clients, null);
  const result = await adsApi<{
    connections: Array<{
      id: string;
      connectorId: string;
      status: string;
      pixelToken: string | null;
      settings: Record<string, unknown>;
    }>;
    signal: { why?: string; eventCount?: number; source?: string } | null;
    enabled: boolean;
  }>(selected ? `/funnel?clientId=${selected.id}` : '/funnel');
  const connections = result.ok ? result.data.connections : [];
  const signal = result.ok ? result.data.signal : null;
  const pixel = connections.find((row) => row.connectorId === 'first_party' && row.status === 'connected');
  const canWrite = adsCapabilityWritable(cockpit.workspace, 'm51.ga4_connect');

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads · Funnel</p>
      <h1>Funnel</h1>
      <p className="cx-lede">
        Connect Google Analytics or add a small Cerevex pixel so we can see ad → page → lead. This is not visitor video or heatmaps.
      </p>
      {signal?.why ? (
        <section className="cx-panel">
          <h2>What the funnel shows</h2>
          <p>{signal.why}</p>
          <details className="cx-details">
            <summary>Details</summary>
            <p>Events stored: {signal.eventCount ?? 0}. Source: {signal.source ?? 'none'}.</p>
            <p>We keep events for 90 days, last-touch only (utm / gclid / fbclid). No names, emails, or recordings.</p>
          </details>
        </section>
      ) : null}
      <FunnelConnectForm clientId={selected?.id} canWrite={canWrite} />
      {connections.length > 0 ? (
        <section className="cx-panel">
          <h2>Connected sources</h2>
          <ul>
            {connections.map((row) => (
              <li key={row.id}>
                {row.connectorId === 'ga4' ? 'GA4' : 'Cerevex pixel'} — {row.status}
                {typeof row.settings.propertyId === 'string' && row.settings.propertyId
                  ? ` · ${row.settings.propertyId}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pixel?.pixelToken ? (
        <section className="cx-panel">
          <h2>Pixel snippet</h2>
          <p className="cx-help">Paste this on the landing page. It sends page views and optional leads only.</p>
          <pre>{`<script src="/api/ads/pixel?token=${pixel.pixelToken}" async></script>`}</pre>
        </section>
      ) : null}
      <nav className="cx-inline-nav">
        <Link href="/ads/suggestions">Suggestions</Link>
        <Link href="/ads">Ads home</Link>
      </nav>
    </div>
  );
}
