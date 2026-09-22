import { redirect } from 'next/navigation';
import { AdsModulePlaceholder } from '@/components/ads/module-placeholder';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsSalesPage() {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');
  if (!settings.modules.sales) redirect('/ads');
  return (
    <AdsModulePlaceholder
      title="Sales"
      body="For online stores tracking orders and sales. This workspace is a placeholder only."
    />
  );
}
