import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConnectEmpty } from '@/components/ads/connect-empty';
import { loadAdsCockpit } from '@/lib/ads-bff';
import { platformLabel, shortWhen } from '@/lib/ads-copy';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsClientsPage() {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');
  if (!settings.modules.clients) redirect('/ads');

  const cockpit = await loadAdsCockpit();

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>Clients</h1>
      <p className="cx-lede">Businesses you run ads for. Open one to check ads and read suggestions.</p>

      {!cockpit.ok ? (
        <ConnectEmpty title="Clients are not connected yet." body={cockpit.message} />
      ) : cockpit.clients.length === 0 ? (
        <ConnectEmpty title="No clients yet." body="Nothing is listed until a client is added. No sample rows are shown." />
      ) : (
        <div className="cx-card-grid">
          {cockpit.clients.map((client) => (
            <article key={client.id} className="cx-card">
              <h3 className="cx-card-title">{client.name}</h3>
              <p className="cx-help">
                {(client.connectedPlatforms ?? []).map(platformLabel).join(' · ') || 'No platforms connected'}
              </p>
              <p className="cx-help">Last sync: {shortWhen(client.lastSyncAt)}</p>
              <Link href={`/ads?client=${client.id}`} className="cx-card-link">Open in Ads</Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
