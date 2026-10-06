import {
  OPERATOR_CAPABILITY_CATALOG_LIST,
  capabilityOnBlockedReason,
  isApplySafetyCapability,
  isCapabilityId,
  isCapabilityState,
} from '@cerevex/contracts';
import { ADS_OWNER_UNPAUSE_PATH, adsSafetySettingsHref } from '@/lib/module-origins';
import { getWorkspaceProductSettings, saveCapabilityOverrides } from '@/src/lib/db/workspace-modules';
import { SubmitButton } from '@/components/submit-button';

async function saveCapabilityAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const id = String(formData.get('id') ?? '');
  const state = formData.get('state');
  if (!isCapabilityId(id) || !isCapabilityState(state)) {
    redirect('/settings?capabilities=error');
    return;
  }
  if (capabilityOnBlockedReason(id, state) || (isApplySafetyCapability(id) && state === 'on')) {
    redirect('/settings?capabilities=error');
    return;
  }
  try {
    await saveCapabilityOverrides({ [id]: state });
  } catch (error) {
    const digest = error && typeof error === 'object' && 'digest' in error ? String((error as { digest?: unknown }).digest ?? '') : '';
    if (digest.startsWith('NEXT_REDIRECT')) throw error;
    redirect('/settings?capabilities=error');
  }
  revalidatePath('/');
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect('/settings?capabilities=saved');
}

export async function WorkspaceCapabilitiesSettings() {
  const settings = await getWorkspaceProductSettings();

  return (
    <div id="capabilities" className="cx-panel">
      <h2>Capability flags</h2>
      <p className="cx-help">
        Per-workspace product flags. Work that is not live yet is not listed here.
        Changing a flag here hides it on the next request — no Site Brain redeploy.
      </p>
      <div className="space-y-4">
        {OPERATOR_CAPABILITY_CATALOG_LIST.map((entry) => {
          const safety = isApplySafetyCapability(entry.id);
          const current = settings.capabilities[entry.id];
          return (
          <form key={entry.id} action={saveCapabilityAction} className="flex items-start justify-between gap-4 border-t pt-3">
            <span>
              <span className="block font-medium">
                {entry.label}
                {entry.unfinished ? ' · unfinished' : ''}
              </span>
              <span className="block text-sm" style={{ color: 'var(--muted-foreground)' }}>{entry.help}</span>
              <span className="block text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>{entry.id}</span>
            </span>
            <span className="flex items-center gap-2">
              <input type="hidden" name="id" value={entry.id} />
              {safety ? (
                <a className="btn-secondary text-sm" href={adsSafetySettingsHref() || ADS_OWNER_UNPAUSE_PATH}>Turn on in Ads</a>
              ) : null}
              {safety && current === 'on' ? (
                <input type="hidden" name="state" value="hidden" />
              ) : (
                <select
                  name="state"
                  defaultValue={safety ? (current === 'recommend_only' ? 'recommend_only' : 'hidden') : current}
                  className="text-sm border px-2 py-1"
                >
                  {safety ? null : <option value="on">On</option>}
                  <option value="recommend_only">Recommend only</option>
                  <option value="hidden">Hidden</option>
                </select>
              )}
              <SubmitButton className="btn-secondary" pendingLabel="Saving…">
                {safety && current === 'on' ? 'Turn off here' : 'Save'}
              </SubmitButton>
            </span>
          </form>
          );
        })}
      </div>
    </div>
  );
}
