import { redirect } from 'next/navigation';
import { AdsModulePlaceholder } from '@/components/ads/module-placeholder';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsLeadsPage() {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');
  if (!settings.modules.leads) redirect('/ads');
  return (
    <AdsModulePlaceholder
      title="Leads"
      body="People who contacted you (forms, calls, messages). This list is not built in this slice."
    />
  );
}
