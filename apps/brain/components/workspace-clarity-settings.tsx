import { isCapabilityVisible, isCapabilityWritable } from '@cerevex/contracts';
import { adsApi, type AdsClient } from '@/lib/ads-bff';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

async function clarityAction(formData: FormData) {
  'use server';
  const { revalidatePath } = await import('next/cache');
  const { redirect } = await import('next/navigation');
  const clientId = String(formData.get('clientId') ?? '');
  const intent = String(formData.get('intent') ?? '');
  if (!clientId) {
    redirect('/settings?clarity=error');
    return;
  }
  const path =
    intent === 'pull'
      ? '/connectors/clarity/pull'
      : intent === 'disconnect'
        ? '/connectors/clarity/disconnect'
        : '/connectors/clarity/connect';
  const body: Record<string, unknown> = { clientId };
  if (intent === 'connect_mock') body.mock = true;
  if (intent === 'connect_env') body.useEnv = true;
  if (intent === 'connect_key') {
    body.apiKey = String(formData.get('apiKey') ?? '');
    body.projectId = String(formData.get('projectId') ?? '');
  }
  const result = await adsApi(path, { method: 'POST', body: JSON.stringify(body) });
  revalidatePath('/settings');
  revalidatePath('/ads');
  redirect(result.ok ? '/settings?clarity=saved' : '/settings?clarity=error');
}

type LpView = {
  visible: boolean;
  clarity?: {
    connected: boolean;
    mock: boolean;
    projectId: string | null;
    sessionCount: number;
    signalCount: number;
  };
};

export async function WorkspaceClaritySettings() {
  const settings = await getWorkspaceProductSettings();
  const clarityVisible = isCapabilityVisible('m52.clarity_connect', settings.capabilities);
  const lpVisible = isCapabilityVisible('m52.lp_intelligence', settings.capabilities);
  if (!clarityVisible && !lpVisible) return null;

  const clarityWrite = isCapabilityWritable('m52.clarity_connect', settings.capabilities);
  const clientsRes = await adsApi<{ clients: AdsClient[] }>('/clients');
  const clients = clientsRes.ok ? clientsRes.data.clients : [];
  const defaultClient = clients[0];

  let clarityState: LpView['clarity'] | undefined;
  if (defaultClient) {
    const view = await adsApi<LpView>(`/clients/${defaultClient.id}/lp-intelligence`);
    if (view.ok) clarityState = view.data.clarity;
  }

  return (
    <div id="clarity" className="mb-8 border p-4 rounded">
      <h2 className="font-semibold mb-2">Clarity and LP intelligence</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
        Connect Microsoft Clarity for aggregated heatmap and session signals. Mock is safe for QA.
        Cerevex does not record sessions or build a heatmap in-house. Site apply later — nothing writes the website.
      </p>
      {clients.length === 0 ? (
        <p className="text-sm">No ads clients yet. Ads checks need a client first.</p>
      ) : (
        <div className="space-y-3">
          {clarityState?.connected ? (
            <p className="text-sm">
              Clarity is connected{clarityState.mock ? ' (mock)' : ''}.
              {clarityState.projectId ? ` Project ${clarityState.projectId}.` : ''}
              {clarityState.signalCount ? ` ${clarityState.signalCount} signals pulled.` : ''}
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Connect with mock (QA) or a Clarity Data Export token. Recs appear after a check when LP intelligence is on.
            </p>
          )}
          {clarityVisible ? (
            <>
              <form action={clarityAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="connect_mock" />
                <label className="text-sm">
                  Client
                  <select name="clientId" defaultValue={defaultClient?.id} className="block border px-2 py-1">
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={!clarityWrite}>Connect Clarity (mock)</button>
              </form>
              <form action={clarityAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="connect_env" />
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <button type="submit" disabled={!clarityWrite}>Connect using CLARITY_* env</button>
              </form>
              <form action={clarityAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="connect_key" />
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <label className="text-sm">
                  API token
                  <input name="apiKey" type="password" autoComplete="off" className="block border px-2 py-1" />
                </label>
                <label className="text-sm">
                  Project id
                  <input name="projectId" className="block border px-2 py-1" />
                </label>
                <button type="submit" disabled={!clarityWrite}>Connect Clarity (live token)</button>
              </form>
              <form action={clarityAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="clientId" value={defaultClient?.id ?? ''} />
                <button name="intent" value="pull" type="submit" disabled={!clarityWrite}>Pull session signals</button>
                <button name="intent" value="disconnect" type="submit" disabled={!clarityWrite}>Disconnect Clarity</button>
              </form>
              {!clarityWrite ? (
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Clarity is recommend-only. Connect and pull stay off.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              Turn on Clarity connect to pull signals. LP intelligence recs stay hidden until that flag is visible.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
