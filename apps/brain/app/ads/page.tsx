import { adsModuleHref, adsModuleOrigin } from '@/lib/module-origins';

export const dynamic = 'force-dynamic';

function ModuleCard({
  href,
  title,
  body,
  external,
}: {
  href: string;
  title: string;
  body: string;
  external: boolean;
}) {
  return (
    <a
      href={href}
      className="border p-4 rounded block hover:bg-muted"
      {...(external ? { rel: 'noreferrer' } : {})}
    >
      <div className="text-sm text-muted-foreground">Ads</div>
      <div className="text-xl font-bold mt-1">{title}</div>
      <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>{body}</p>
    </a>
  );
}

export default function AdsModulePage() {
  const origin = adsModuleOrigin();
  const external = Boolean(origin);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Ads</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-foreground)' }}>
        Ad accounts and recommendations for this store. Ads stay paused until you apply a change.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <ModuleCard
          href={adsModuleHref('/app')}
          title="Clients"
          body="Ad accounts, sync, and recommendations."
          external={external}
        />
        <ModuleCard
          href={adsModuleHref('/app/brainstorm')}
          title="Leads"
          body="Campaign ideas. Nothing here changes ads today."
          external={external}
        />
        <ModuleCard
          href={adsModuleHref('/app/workflows')}
          title="Workflows"
          body="Automations. Nothing runs without an explicit go-ahead."
          external={external}
        />
      </div>

      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        This is the Ads module in the Cerevex shell. Apply stays a separate step. No unsupervised spend.
      </p>
    </div>
  );
}
