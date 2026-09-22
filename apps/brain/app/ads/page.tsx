import { MODULE_COPY } from '@shopify-brain/contracts';
import { adsSub } from '@/lib/ads-nav';
import { adsModuleOrigin } from '@/lib/module-origins';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';
import Link from 'next/link';
import { redirect } from 'next/navigation';

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

export default async function AdsModulePage() {
  const origin = adsModuleOrigin();
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) {
    redirect('/onboarding');
  }
  const items = adsSub(origin, settings.modules).filter((item) => item.rail);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Ads</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-foreground)' }}>
        Only the modules you turned on are listed here. Ads stay paused until you apply a change.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {items.map((item) => {
          const copy = item.module ? MODULE_COPY[item.module] : null;
          const external = item.href.startsWith('http://') || item.href.startsWith('https://');
          return (
            <ModuleCard
              key={`${item.label}-${item.href}`}
              href={item.href}
              title={item.label}
              body={copy?.help ?? 'Open this Ads module.'}
              external={external}
            />
          );
        })}
      </div>

      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Change modules anytime in{' '}
        <Link href="/settings#modules" className="underline">Settings → Modules</Link>
        . Apply stays a separate step. No unsupervised spend.
      </p>
    </div>
  );
}
