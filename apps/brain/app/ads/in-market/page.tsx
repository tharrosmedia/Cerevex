import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  IN_MARKET_CONNECT_GOOGLE,
  IN_MARKET_CONNECT_META,
  IN_MARKET_HELPER,
  IN_MARKET_LOAD_ERROR,
  IN_MARKET_WINDOWS,
  parseInMarketWindow,
  type InMarketPlatform,
  type InMarketView,
  type InMarketWindowId,
} from '@cerevex/contracts';
import { InMarketTree } from '@/components/ads/in-market-tree';
import { AdsCapabilityOff } from '@/components/ads/capability-off';
import { adsApi, type AdsWorkspace } from '@/lib/ads-bff';
import { adsCapabilityVisible } from '@/lib/ads-capabilities';
import { resolveSiteAds } from '@/lib/ads-site';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

function pageHref(platform: InMarketPlatform | null, window: InMarketWindowId): string {
  const query = new URLSearchParams();
  if (platform) query.set('platform', platform);
  if (window !== '7d') query.set('window', window);
  const suffix = query.toString();
  return suffix ? `/ads/in-market?${suffix}` : '/ads/in-market';
}

function LoadError({ href }: { href: string }) {
  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>In market</h1>
      <p className="cx-banner cx-banner-warn" role="alert">
        <Link href={href}>{IN_MARKET_LOAD_ERROR}</Link>
      </p>
    </div>
  );
}

export default async function InMarketPage({
  searchParams,
}: {
  searchParams?: Promise<{ platform?: string; window?: string }>;
}) {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');

  const params = (await (searchParams ?? Promise.resolve({}))) as { platform?: string; window?: string };
  const window = parseInMarketWindow(params.window);
  const requested: InMarketPlatform | null = params.platform === 'google' || params.platform === 'meta' ? params.platform : null;

  let workspace: AdsWorkspace | null = null;
  try {
    const workspaceRes = await adsApi<{ workspace: AdsWorkspace | null }>('/workspace');
    if (!workspaceRes.ok) {
      return <LoadError href={pageHref(requested, window)} />;
    }
    workspace = workspaceRes.data.workspace;
  } catch {
    return <LoadError href={pageHref(requested, window)} />;
  }

  if (!adsCapabilityVisible(workspace, 'in_market')) {
    return (
      <AdsCapabilityOff
        title="In market is off"
        body="This workspace hid In market. Cockpit and Approve are unchanged. Flip the In market flag in Settings to show live inventory."
      />
    );
  }

  let siteClientId: string | null = null;
  try {
    const siteAds = await resolveSiteAds();
    siteClientId = siteAds.client?.id ?? null;
  } catch {
    return <LoadError href={pageHref(requested, window)} />;
  }
  if (!siteClientId) {
    return (
      <div className="cx-page">
        <p className="cx-kicker">Ads</p>
        <h1>In market</h1>
        <p className="cx-lede">What is running on the ad accounts connected to this site.</p>
        <section className="cx-empty">
          <p>{IN_MARKET_CONNECT_META}</p>
          <p>{IN_MARKET_CONNECT_GOOGLE}</p>
        </section>
      </div>
    );
  }

  const inventory = await adsApi<InMarketView | { visible: false }>(
    `/clients/${siteClientId}/in-market?window=${window}`,
  );
  if (!inventory.ok) {
    return <LoadError href={pageHref(requested, window)} />;
  }
  if (!inventory.data.visible) {
    return (
      <AdsCapabilityOff
        title="In market is off"
        body="This workspace hid In market. Cockpit and Approve are unchanged. Flip the In market flag in Settings to show live inventory."
      />
    );
  }

  const view = inventory.data;
  const selected = view.platforms.find((section) => section.platform === requested) ?? view.platforms[0] ?? null;

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads</p>
      <h1>In market</h1>
      <p className="cx-lede">What is running on the ad accounts connected to this site.</p>

      {view.platforms.length > 0 ? (
        <nav className="cx-market-tabs" aria-label="Platforms">
          {view.platforms.map((section) => (
            <Link
              key={section.platform}
              href={pageHref(section.platform, view.window)}
              aria-current={selected?.platform === section.platform ? 'page' : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>
      ) : (
        <section className="cx-empty">
          <p>{IN_MARKET_CONNECT_META}</p>
          <p>{IN_MARKET_CONNECT_GOOGLE}</p>
        </section>
      )}

      {selected ? (
        <>
          <nav className="cx-market-controls" aria-label="Date window">
            {IN_MARKET_WINDOWS.map((preset) => (
              <Link
                key={preset.id}
                href={pageHref(selected.platform, preset.id)}
                aria-current={view.window === preset.id ? 'page' : undefined}
              >
                {preset.label}
              </Link>
            ))}
          </nav>
          <p className="cx-help">{IN_MARKET_HELPER}</p>
          {selected.staleLabel ? <p className="cx-help">{selected.staleLabel}</p> : null}
          {selected.empty ? (
            <section className="cx-empty">
              <p>{selected.emptyCopy}</p>
            </section>
          ) : (
            selected.accounts
              .filter((account) => account.campaigns.length > 0)
              .map((account) => (
                <section key={account.id} className="cx-panel">
                  <h2>{account.name}</h2>
                  {account.truncated ? <p className="cx-help">Showing the first 200 campaigns.</p> : null}
                  <InMarketTree campaigns={account.campaigns} />
                </section>
              ))
          )}
        </>
      ) : null}
    </div>
  );
}
