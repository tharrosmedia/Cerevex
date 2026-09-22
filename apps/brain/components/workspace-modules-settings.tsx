import {
  ADS_MODULE_IDS,
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  MODULE_COPY,
  isBusinessType,
  type BusinessType,
} from '@shopify-brain/contracts/modules';
import { getWorkspaceModuleSettings, saveBusinessType, saveModuleOverrides } from '@/src/lib/db/workspace-modules';

async function saveTypeAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const value = formData.get('businessType');
  if (!isBusinessType(value)) {
    redirect('/settings?modules=error');
  }
  await saveBusinessType(value as BusinessType);
  revalidatePath('/');
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect('/settings?modules=type');
}

async function saveModulesAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  await saveModuleOverrides({
    leads: formData.get('leads') === 'on',
    clients: formData.get('clients') === 'on',
    sales: formData.get('sales') === 'on',
    workflows: formData.get('workflows') === 'on',
  });
  revalidatePath('/');
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect('/settings?modules=saved');
}

export async function WorkspaceModulesSettings() {
  const settings = await getWorkspaceModuleSettings();

  return (
    <div id="modules" className="mb-8 border p-4 rounded">
      <h2 className="font-semibold mb-2">Modules</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
        The Ads menu only shows modules that are on. Change these anytime. This does not apply ads or spend money.
      </p>

      <div className="mb-6">
        <div className="text-sm mb-2">
          Business type:{' '}
          <strong>{settings.businessType ? BUSINESS_TYPE_LABELS[settings.businessType] : 'Not chosen yet'}</strong>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--muted-foreground)' }}>
          Picking a type resets modules to the defaults for that type.
        </p>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_TYPES.map((type) => (
            <form key={type} action={saveTypeAction}>
              <input type="hidden" name="businessType" value={type} />
              <button type="submit">{BUSINESS_TYPE_LABELS[type]}</button>
            </form>
          ))}
        </div>
      </div>

      <form action={saveModulesAction}>
        {ADS_MODULE_IDS.map((id) => (
          <div key={id} style={{ borderTop: '1px solid var(--border)', padding: '0.85rem 0' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
              <span>
                <span style={{ display: 'block', fontWeight: 600 }}>{MODULE_COPY[id].label}</span>
                <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.9rem', color: 'var(--muted-foreground)' }}>
                  {MODULE_COPY[id].help}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' }}>
                <input type="checkbox" name={id} defaultChecked={settings.modules[id]} />
                On
              </span>
            </label>
          </div>
        ))}
        <button type="submit">Save modules</button>
      </form>
    </div>
  );
}
