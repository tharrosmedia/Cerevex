import { redirect } from 'next/navigation';
import { BUSINESS_TYPE_HELP } from '@cerevex/contracts';
import {
  CLIENT_BUSINESS_TYPES,
  CLIENT_BUSINESS_TYPE_LABELS,
  isClientBusinessType,
} from '@/src/lib/db/client-workspace';
import { saveBusinessType } from '@/src/lib/db/workspace-modules';

async function chooseBusinessType(formData: FormData) {
  'use server';
  const value = formData.get('businessType');
  if (!isClientBusinessType(value)) {
    redirect('/onboarding?error=1');
  }
  await saveBusinessType(value);
  redirect('/ads');
}

export const dynamic = 'force-dynamic';

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = await (searchParams || Promise.resolve({})) as { error?: string };

  return (
    <div className="cx-page">
      <p className="cx-kicker">Get started</p>
      <h1>What kind of business is this?</h1>
      <p className="cx-lede">
        This sets which Ads modules you see. Leads stay on for everyone. You can change modules later in Settings.
      </p>

      {params.error && (
        <p className="cx-banner cx-banner-warn">Could not save that choice. Try again.</p>
      )}

      <div className="cx-card-grid">
        {CLIENT_BUSINESS_TYPES.map((type) => (
          <form key={type} action={chooseBusinessType} className="cx-card">
            <input type="hidden" name="businessType" value={type} />
            <h2 className="cx-card-title">{CLIENT_BUSINESS_TYPE_LABELS[type]}</h2>
            <p className="cx-help">{BUSINESS_TYPE_HELP[type]}</p>
            <button type="submit" className="btn-cta">Use {CLIENT_BUSINESS_TYPE_LABELS[type]}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
