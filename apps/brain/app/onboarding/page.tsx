import { redirect } from 'next/navigation';
import {
  BUSINESS_TYPE_HELP,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  isBusinessType,
  type BusinessType,
} from '@shopify-brain/contracts';
import { saveBusinessType } from '@/src/lib/db/workspace-modules';

async function chooseBusinessType(formData: FormData) {
  'use server';
  const value = formData.get('businessType');
  if (!isBusinessType(value)) {
    redirect('/onboarding?error=1');
  }
  await saveBusinessType(value as BusinessType);
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
    <div className="p-8 max-w-3xl mx-auto">
      <p className="text-sm mb-2" style={{ color: 'var(--muted-foreground)' }}>Get started</p>
      <h1 className="text-3xl font-bold mb-2">What kind of business is this?</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-foreground)' }}>
        This sets which Ads modules you see. Leads stay on for everyone. You can change modules later in Settings.
      </p>

      {params.error && (
        <div className="mb-4 p-3 border text-sm">Could not save that choice. Try again.</div>
      )}

      <div className="space-y-4">
        {BUSINESS_TYPES.map((type) => (
          <form key={type} action={chooseBusinessType} className="border p-4">
            <input type="hidden" name="businessType" value={type} />
            <div className="text-xl font-bold">{BUSINESS_TYPE_LABELS[type]}</div>
            <p className="text-sm mt-2 mb-4" style={{ color: 'var(--muted-foreground)' }}>
              {BUSINESS_TYPE_HELP[type]}
            </p>
            <button type="submit" className="btn-cta">Use {BUSINESS_TYPE_LABELS[type]}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
