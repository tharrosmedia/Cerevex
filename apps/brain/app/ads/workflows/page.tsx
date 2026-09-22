import { redirect } from 'next/navigation';
import { AdsModulePlaceholder } from '@/components/ads/module-placeholder';
import { getWorkspaceModuleSettings } from '@/src/lib/db/workspace-modules';

export const dynamic = 'force-dynamic';

export default async function AdsWorkflowsPage() {
  const settings = await getWorkspaceModuleSettings();
  if (!settings.onboardingComplete) redirect('/onboarding');
  if (!settings.modules.workflows) redirect('/ads');
  return (
    <AdsModulePlaceholder
      title="Workflows"
      body="Workflow builder is out of scope for this Ads check slice."
    />
  );
}
