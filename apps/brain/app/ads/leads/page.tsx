import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isLeadsSurfaceVisible } from '@cerevex/contracts';
import { PromoteIdeaButton } from '@/components/ads/promote-idea-button';
import { adsApi } from '@/lib/ads-bff';
import { adsCapabilityWritable } from '@/lib/ads-capabilities';
import { platformLabel } from '@/lib/ads-copy';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

type Idea = {
  id: string;
  clientId: string | null;
  title: string;
  body: {
    promoted?: boolean;
    recommendationId?: string;
    alternative?: {
      headline?: string;
      body?: string;
      offer?: string;
      videoScript?: string;
      targetPlatform?: string;
      assets?: Array<{ kind: string; url?: string | null; note?: string }>;
    };
  };
  createdAt: string;
};

export default async function AdsLeadsPage() {
  const settings = await getWorkspaceProductSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');
  if (!isLeadsSurfaceVisible(settings.modules, settings.capabilities)) redirect('/ads');

  const ideasRes = await adsApi<{ ideas: Idea[] }>('/brainstorm/ideas');
  const ideas = ideasRes.ok ? ideasRes.data.ideas : [];
  const canPromote =
    adsCapabilityWritable({ applyKillSwitch: false, id: '', name: '', capabilities: settings.capabilities }, 'm51.grok_creatives') ||
    adsCapabilityWritable({ applyKillSwitch: false, id: '', name: '', capabilities: settings.capabilities }, 'm51.brainstorm');

  return (
    <div className="cx-page">
      <p className="cx-kicker">Ads · Brainstorm</p>
      <h1>Brainstorm</h1>
      <p className="cx-lede">
        Grok alternatives live here. Promote one to a suggestion, then Approve. Generate never writes live ads.
      </p>
      {ideas.length === 0 ? (
        <section className="cx-panel">
          <p className="cx-help">
            No alternatives yet. Open <Link href="/ads/creatives">Creatives</Link> and choose “Adapt / make another”.
          </p>
        </section>
      ) : (
        <div className="cx-card-grid">
          {ideas.map((idea) => {
            const alt = idea.body.alternative;
            return (
              <article key={idea.id} className="cx-card">
                <div className="cx-card-kicker">
                  <span>{platformLabel(alt?.targetPlatform)}</span>
                  <span>{idea.body.promoted ? 'Promoted' : 'Draft'}</span>
                </div>
                <h3 className="cx-card-title">{alt?.headline ?? idea.title}</h3>
                <p className="cx-card-why">{alt?.body ?? 'No copy yet.'}</p>
                {alt?.assets?.some((asset) => asset.url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={alt.assets.find((asset) => asset.url)?.url ?? ''}
                    alt=""
                    width={320}
                    height={320}
                    style={{ width: '100%', height: 'auto' }}
                  />
                ) : null}
                <details className="cx-details">
                  <summary>Details</summary>
                  <p>{alt?.videoScript ?? 'No video script yet.'}</p>
                  <ul>
                    {(alt?.assets ?? []).map((asset, index) => (
                      <li key={`${idea.id}-a-${index}`}>
                        {asset.kind}: {asset.note ?? 'saved'}
                      </li>
                    ))}
                  </ul>
                </details>
                {idea.body.promoted && idea.body.recommendationId ? (
                  <Link href={`/ads/suggestions/${idea.body.recommendationId}`} className="cx-card-link">
                    Open suggestion
                  </Link>
                ) : idea.clientId ? (
                  <PromoteIdeaButton clientId={idea.clientId} ideaId={idea.id} canPromote={canPromote} />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <nav className="cx-inline-nav">
        <Link href="/ads/creatives">Creatives</Link>
        <Link href="/ads/suggestions">Suggestions</Link>
        <Link href="/ads">Ads home</Link>
      </nav>
    </div>
  );
}
