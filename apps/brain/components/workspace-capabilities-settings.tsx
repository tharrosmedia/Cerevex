import {
  OPERATOR_CAPABILITY_CATALOG_LIST,
  capabilityOnBlockedReason,
  isCapabilityId,
  isCapabilityState,
} from '@shopify-brain/contracts';
import { getWorkspaceProductSettings, saveCapabilityOverrides } from '@/src/lib/db/workspace-modules';

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
  if (capabilityOnBlockedReason(id, state)) {
    redirect('/settings?capabilities=error');
    return;
  }
  await saveCapabilityOverrides({ [id]: state });
  revalidatePath('/');
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect('/settings?capabilities=saved');
}

export async function WorkspaceCapabilitiesSettings() {
  const settings = await getWorkspaceProductSettings();

  return (
    <div id="capabilities" className="mb-8 border p-4 rounded">
      <h2 className="font-semibold mb-2">Capabilities</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
        Per-workspace product flags. Work that is not live yet is not listed here.
        Changing a flag here hides it on the next request — no Site Brain redeploy.
      </p>
      <div className="space-y-4">
        {OPERATOR_CAPABILITY_CATALOG_LIST.map((entry) => (
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
              <select name="state" defaultValue={settings.capabilities[entry.id]} className="text-sm border px-2 py-1">
                <option value="on">On</option>
                <option value="recommend_only">Recommend only</option>
                <option value="hidden">Hidden</option>
              </select>
              <button type="submit">Save</button>
            </span>
          </form>
        ))}
      </div>
    </div>
  );
}
