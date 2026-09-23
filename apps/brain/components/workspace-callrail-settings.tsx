import { isCapabilityVisible, isCapabilityWritable } from '@cerevex/contracts';
import { adsApi, type AdsClient } from '@/lib/ads-bff';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

async function callrailAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const clientId = String(formData.get('clientId') ?? '');
  const intent = String(formData.get('intent') ?? '');
  if (!clientId) {
    redirect('/settings?callrail=error');
    return;
  }
  const path =
    intent === 'pull'
      ? '/connectors/callrail/pull'
      : intent === 'disconnect'
        ? '/connectors/callrail/disconnect'
        : intent === 'crm_connect' || intent === 'crm_connect_env' || intent === 'crm_connect_key'
          ? '/connectors/crm/connect'
          : intent === 'crm_disconnect'
            ? '/connectors/crm/disconnect'
            : intent === 'crm_pull'
              ? '/connectors/crm/pull'
            : '/connectors/callrail/connect';
  const body: Record<string, unknown> = { clientId };
  if (intent === 'connect_mock' || intent === 'crm_connect') body.mock = true;
  if (intent === 'connect_env' || intent === 'crm_connect_env') body.useEnv = true;
  if (intent === 'connect_key') {
    body.apiKey = String(formData.get('apiKey') ?? '');
    body.accountId = String(formData.get('accountId') ?? '');
  }
  if (intent === 'crm_connect_key') {
    body.apiKey = String(formData.get('hcpApiKey') ?? '');
  }
  const result = await adsApi(path, { method: 'POST', body: JSON.stringify(body) });
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect(result.ok ? '/settings?callrail=saved' : '/settings?callrail=error');
}

export async function WorkspaceCallRailSettings() {
  const settings = await getWorkspaceProductSettings();
  const callrailVisible = isCapabilityVisible('m52.callrail_connect', settings.capabilities);
  const crmVisible = isCapabilityVisible('m52.crm_join', settings.capabilities);
  if (!callrailVisible && !crmVisible) return null;

  const callrailWrite = isCapabilityWritable('m52.callrail_connect', settings.capabilities);
  const crmWrite = isCapabilityWritable('m52.crm_join', settings.capabilities);
  const clientsRes = await adsApi<{ clients: AdsClient[] }>('/clients');
  const clients = clientsRes.ok ? clientsRes.data.clients : [];
  const defaultClient = clients.find((client) => client.name === 'Got Ductless') ?? clients[0];

  return (
    <div id="callrail" className="mb-8 border p-4 rounded">
      <h2 className="font-semibold mb-2">CallRail and booked jobs</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
        Connect Got Ductless CallRail with a mock (QA) or a real API key. Calls join to campaigns in plain language.
        Housecall Pro can connect with a mock (QA) or a live API key. Cerevex pulls leads and booked jobs. It does not write the CRM from connect or pull.
      </p>
      {clients.length === 0 ? (
        <p className="text-sm">No ads clients yet. Ads checks need a client first.</p>
      ) : (
        <>
          {callrailVisible ? (
            <div className="space-y-3 mb-4">
              <form action={callrailAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="connect_mock" />
                <label className="text-sm">
                  Client
                  <select name="clientId" defaultValue={defaultClient?.id} className="block border px-2 py-1">
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={!callrailWrite}>Connect CallRail (mock)</button>
              </form>
              <form action={callrailAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="connect_env" />
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <button type="submit" disabled={!callrailWrite}>Connect using CALLRAIL_* env</button>
              </form>
              <form action={callrailAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="connect_key" />
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <label className="text-sm">
                  API key
                  <input name="apiKey" type="password" autoComplete="off" className="block border px-2 py-1" />
                </label>
                <label className="text-sm">
                  Account id
                  <input name="accountId" className="block border px-2 py-1" />
                </label>
                <button type="submit" disabled={!callrailWrite}>Connect CallRail (live key)</button>
              </form>
              <form action={callrailAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <button name="intent" value="pull" type="submit" disabled={!callrailWrite}>Pull calls</button>
                <button name="intent" value="disconnect" type="submit" disabled={!callrailWrite}>Disconnect CallRail</button>
              </form>
              {!callrailWrite ? (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  CallRail is recommend-only. Connect and pull stay off.
                </p>
              ) : null}
            </div>
          ) : null}
          {crmVisible ? (
            <div className="space-y-3">
              <form action={callrailAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <button name="intent" value="crm_connect" type="submit" disabled={!crmWrite}>Connect Housecall Pro (mock)</button>
                <button name="intent" value="crm_connect_env" type="submit" disabled={!crmWrite}>Connect using HCP_API_KEY env</button>
                <button name="intent" value="crm_pull" type="submit" disabled={!crmWrite}>Pull leads and jobs</button>
                <button name="intent" value="crm_disconnect" type="submit" disabled={!crmWrite}>Disconnect Housecall Pro</button>
              </form>
              <form action={callrailAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="crm_connect_key" />
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <label className="text-sm">
                  Housecall Pro API key
                  <input name="hcpApiKey" type="password" autoComplete="off" className="block border px-2 py-1" />
                </label>
                <button type="submit" disabled={!crmWrite}>Connect Housecall Pro (live key)</button>
              </form>
              {!crmWrite ? (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  CRM join is recommend-only. Connect and pull stay off.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
