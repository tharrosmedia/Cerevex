import { isCapabilityVisible, isCapabilityWritable } from '@cerevex/contracts';
import { adsApi, type AdsClient } from '@/lib/ads-bff';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';
import type { SeasonalityView } from '@/components/ads/seasonality-calendar';

async function seasonalityAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const clientId = String(formData.get('clientId') ?? '');
  if (!clientId) {
    redirect('/settings?seasonality=error');
    return;
  }
  const windows = [
    {
      id: String(formData.get('id') ?? 'custom-window').trim() || 'custom-window',
      name: String(formData.get('name') ?? '').trim(),
      kind: String(formData.get('kind') ?? 'offer'),
      startMonth: Number(formData.get('startMonth')),
      startDay: Number(formData.get('startDay')),
      endMonth: Number(formData.get('endMonth')),
      endDay: Number(formData.get('endDay')),
      intent: String(formData.get('intent') ?? 'hold'),
      campaignHint: String(formData.get('campaignHint') ?? '').trim() || null,
      offerCopy: String(formData.get('offerCopy') ?? '').trim() || null,
    },
  ];
  const existing = await adsApi<{ seasonality: SeasonalityView | null }>(`/clients/${clientId}/planning`);
  const current = existing.ok && existing.data.seasonality
    ? existing.data.seasonality.windows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        startMonth: row.startMonth,
        startDay: row.startDay,
        endMonth: row.endMonth,
        endDay: row.endDay,
        intent: row.intent,
        campaignHint: row.campaignHint,
        offerCopy: row.offerCopy,
      }))
    : [];
  const next = [...current.filter((row) => row.id !== windows[0]!.id), windows[0]!];
  const result = await adsApi(`/clients/${clientId}/planning/calendar`, {
    method: 'POST',
    body: JSON.stringify({ windows: next }),
  });
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect(result.ok ? '/settings?seasonality=saved' : '/settings?seasonality=error');
}

export async function WorkspaceSeasonalitySettings() {
  const settings = await getWorkspaceProductSettings();
  const visible = isCapabilityVisible('m52.seasonality_calendar', settings.capabilities);
  if (!visible) return null;

  const writable = isCapabilityWritable('m52.seasonality_calendar', settings.capabilities);
  const clientsRes = await adsApi<{ clients: AdsClient[] }>('/clients');
  const clients = clientsRes.ok ? clientsRes.data.clients : [];
  const defaultClient = clients.find((client) => client.name === 'Got Ductless') ?? clients[0];
  const planning = defaultClient
    ? await adsApi<{ seasonality: SeasonalityView | null }>(`/clients/${defaultClient.id}/planning`)
    : null;
  const calendar = planning?.ok ? planning.data.seasonality : null;

  return (
    <div id="seasonality" className="cx-panel">
      <h2 className="font-semibold mb-2">Seasonality and offer calendar</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
        Plan seasonal offers. Calendar-to-campaign recs still need Approve. This save writes workspace settings only — not Meta or Google.
      </p>
      {calendar ? (
        <ul className="text-sm mb-4">
          {calendar.windows.map((window) => (
            <li key={window.id}>
              {window.name} ({window.when}) — {window.intent}
              {window.active ? ' · now' : window.upcoming ? ' · upcoming' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm mb-4">Default HVAC year loads after a client exists.</p>
      )}
      {clients.length === 0 ? (
        <p className="text-sm">No ads clients yet.</p>
      ) : (
        <form action={seasonalityAction} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Client
            <select name="clientId" defaultValue={defaultClient?.id} className="block border px-2 py-1">
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Window id
            <input name="id" defaultValue="custom-offer" className="block border px-2 py-1" />
          </label>
          <label className="text-sm">
            Name
            <input name="name" defaultValue="Spring tune-up offer" className="block border px-2 py-1" required />
          </label>
          <label className="text-sm">
            Kind
            <select name="kind" defaultValue="offer" className="block border px-2 py-1">
              <option value="seasonal">Seasonal</option>
              <option value="offer">Offer</option>
            </select>
          </label>
          <label className="text-sm">
            Start month
            <input name="startMonth" type="number" min={1} max={12} defaultValue={3} className="block border px-2 py-1 w-20" />
          </label>
          <label className="text-sm">
            Start day
            <input name="startDay" type="number" min={1} max={31} defaultValue={1} className="block border px-2 py-1 w-20" />
          </label>
          <label className="text-sm">
            End month
            <input name="endMonth" type="number" min={1} max={12} defaultValue={5} className="block border px-2 py-1 w-20" />
          </label>
          <label className="text-sm">
            End day
            <input name="endDay" type="number" min={1} max={31} defaultValue={31} className="block border px-2 py-1 w-20" />
          </label>
          <label className="text-sm">
            Intent
            <select name="intent" defaultValue="ramp" className="block border px-2 py-1">
              <option value="ramp">Ramp</option>
              <option value="shift">Shift</option>
              <option value="pause">Pause</option>
              <option value="hold">Hold</option>
            </select>
          </label>
          <label className="text-sm">
            Campaign hint
            <input name="campaignHint" defaultValue="tune" className="block border px-2 py-1" />
          </label>
          <label className="text-sm">
            Offer
            <input name="offerCopy" defaultValue="Tune-up from $89." className="block border px-2 py-1" />
          </label>
          <button type="submit" disabled={!writable}>Save window</button>
        </form>
      )}
      {!writable ? (
        <p className="text-sm mt-2" style={{ color: 'var(--muted-foreground)' }}>
          Recommend-only — the calendar is visible. Saving windows needs the flag on.
        </p>
      ) : null}
    </div>
  );
}
