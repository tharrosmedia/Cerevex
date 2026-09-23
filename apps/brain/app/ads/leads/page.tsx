import { redirect } from 'next/navigation';
import { isLeadsSurfaceVisible } from '@cerevex/contracts';
import { AdsModulePlaceholder } from '@/components/ads/module-placeholder';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsLeadsPage() {
  const settings = await getWorkspaceProductSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');
  if (!isLeadsSurfaceVisible(settings.modules, settings.capabilities)) redirect('/ads');
  return (
    <AdsModulePlaceholder
      title="Leads"
      body="People who contacted you (forms, calls, messages). This list is not built in this slice."
    />
  );
}
