import { isCapabilityVisible, isCapabilityWritable } from '@cerevex/contracts';
import { adsApi, type AdsClient } from '@/lib/ads-bff';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

async function bundledAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const clientId = String(formData.get('clientId') ?? '');
  const intent = String(formData.get('intent') ?? '');
  if (!clientId) {
    redirect('/settings?bundled=error');
    return;
  }
  const path =
    intent === 'pull'
      ? '/connectors/bundled/pull'
      : intent === 'disconnect'
        ? '/connectors/bundled/disconnect'
        : '/connectors/bundled/connect';
  const body: Record<string, unknown> = { clientId };
  if (intent === 'connect_mock') body.mock = true;
  if (intent === 'connect_env') body.useEnv = true;
  if (intent === 'connect_key') {
    body.accountSid = String(formData.get('accountSid') ?? '');
    body.authToken = String(formData.get('authToken') ?? '');
    const trackingNumber = String(formData.get('trackingNumber') ?? '').trim();
    const campaignLabel = String(formData.get('campaignLabel') ?? '').trim();
    if (trackingNumber) body.trackingNumber = trackingNumber;
    if (campaignLabel) body.campaignLabel = campaignLabel;
  }
  const result = await adsApi(path, { method: 'POST', body: JSON.stringify(body) });
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect(result.ok ? '/settings?bundled=saved' : '/settings?bundled=error');
}

type OfflineView = {
  visible: boolean;
  callrail?: { connected: boolean };
  bundled?: { connected: boolean; mock: boolean; trackingNumber: string | null; callCount: number };
};

export async function WorkspaceBundledCallTrackingSettings() {
  const settings = await getWorkspaceProductSettings();
  const bundledVisible = isCapabilityVisible('m52.bundled_call_tracking', settings.capabilities);
  if (!bundledVisible) return null;

  const bundledWrite = isCapabilityWritable('m52.bundled_call_tracking', settings.capabilities);
  const clientsRes = await adsApi<{ clients: AdsClient[] }>('/clients');
  const clients = clientsRes.ok ? clientsRes.data.clients : [];
  const defaultClient = clients.find((client) => !/got ductless/i.test(client.name)) ?? clients[0];

  let callrailConnected = false;
  let bundledState: OfflineView['bundled'] | undefined;
  if (defaultClient) {
    const offline = await adsApi<OfflineView>(`/clients/${defaultClient.id}/offline-attribution`);
    if (offline.ok) {
      callrailConnected = Boolean(offline.data.callrail?.connected);
      bundledState = offline.data.bundled;
    }
  }

  return (
    <div id="bundled-call-tracking" className="cx-panel">
      <h2 className="font-semibold mb-2">Bundled call tracking</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
        A paid Cerevex add-on for shops that do not already have CallRail. Mock is safe for QA.
        Live Twilio credentials go in env or the encrypted form. Cerevex will not buy a number or
        change call routing from here.
      </p>
      {clients.length === 0 ? (
        <p className="text-sm">No ads clients yet. Ads checks need a client first.</p>
      ) : callrailConnected ? (
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {defaultClient?.name} already uses CallRail. Disconnect CallRail to switch to this add-on.
          Connect customers stay on CallRail.
        </p>
      ) : (
        <div className="space-y-3">
          {bundledState?.connected ? (
            <p className="text-sm">
              Bundled is on{bundledState.mock ? ' (mock)' : ''}.
              {bundledState.trackingNumber ? ` Tracking number ${bundledState.trackingNumber}.` : ''}
              {bundledState.callCount ? ` ${bundledState.callCount} calls pulled.` : ''}
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Enable the add-on with mock (QA) or a Twilio Account SID. Calls join the same way as CallRail.
            </p>
          )}
          <form action={bundledAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="connect_mock" />
            <label className="text-sm">
              Client
              <select name="clientId" defaultValue={defaultClient?.id} className="block border px-2 py-1">
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!bundledWrite}>Enable bundled (mock)</button>
          </form>
          <form action={bundledAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="connect_env" />
            <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
            <button type="submit" disabled={!bundledWrite}>Connect using TWILIO_* env</button>
          </form>
          <form action={bundledAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="connect_key" />
            <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
            <label className="text-sm">
              Account SID
              <input name="accountSid" autoComplete="off" className="block border px-2 py-1" />
            </label>
            <label className="text-sm">
              Auth token
              <input name="authToken" type="password" autoComplete="off" className="block border px-2 py-1" />
            </label>
            <label className="text-sm">
              Existing tracking number
              <input name="trackingNumber" className="block border px-2 py-1" placeholder="optional" />
            </label>
            <label className="text-sm">
              Campaign label
              <input name="campaignLabel" className="block border px-2 py-1" placeholder="optional" />
            </label>
            <button type="submit" disabled={!bundledWrite}>Connect bundled (live Twilio)</button>
          </form>
          <form action={bundledAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
            <button name="intent" value="pull" type="submit" disabled={!bundledWrite}>Pull calls</button>
            <button name="intent" value="disconnect" type="submit" disabled={!bundledWrite}>Disconnect bundled</button>
          </form>
          {!bundledWrite ? (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Bundled call tracking is recommend-only. Connect and pull stay off.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
