'use server';

import { revalidatePath } from 'next/cache';
import { adsApi } from '@/lib/ads-bff';
import { consoleAuthorized } from '@/lib/console-auth';
import {
  connectorOnFromForm,
  parseClientIds,
  parseCreateForm,
  type McpIdentityView,
} from '@/lib/mcp-connector';

export type ConnectorActionResult =
  | { ok: true; message: string; token?: string }
  | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorized(): Promise<ConnectorActionResult | null> {
  if (await consoleAuthorized()) return null;
  return { ok: false, message: 'Sign in required' };
}

export async function createMcpIdentityAction(formData: FormData): Promise<ConnectorActionResult> {
  const refused = await authorized();
  if (refused) return refused;
  const parsed = parseCreateForm(formData);
  if (!parsed.ok) return parsed;
  const result = await adsApi<{ identity: McpIdentityView; token: string }>(
    '/mcp/identities',
    { method: 'POST', body: JSON.stringify(parsed.body) },
    { asOwner: true, ownerAssertion: true },
  );
  if (!result.ok) return { ok: false, message: result.message };
  const token = result.data.token;
  if (typeof token !== 'string' || !token.startsWith('cxm_')) {
    return { ok: false, message: 'Identity was created but the token was missing. Revoke it and create another.' };
  }
  revalidatePath('/settings');
  return { ok: true, token, message: 'Identity created. Copy the token now. It is not shown again.' };
}

export async function revokeMcpIdentityAction(id: string): Promise<ConnectorActionResult> {
  const refused = await authorized();
  if (refused) return refused;
  if (!UUID.test(id)) return { ok: false, message: 'Identity not found' };
  const result = await adsApi(`/mcp/identities/${id}/revoke`, { method: 'POST' }, { asOwner: true, ownerAssertion: true });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath('/settings');
  return { ok: true, message: 'Identity revoked. The token stops working on the next call.' };
}

export async function grantMcpClientsAction(id: string, formData: FormData): Promise<ConnectorActionResult> {
  const refused = await authorized();
  if (refused) return refused;
  if (!UUID.test(id)) return { ok: false, message: 'Identity not found' };
  const clientIds = parseClientIds(formData.getAll('clientIds'));
  if (!clientIds) return { ok: false, message: 'Choose clients from this workspace.' };
  const result = await adsApi(
    `/mcp/identities/${id}/grants`,
    { method: 'PUT', body: JSON.stringify({ clientIds }) },
    { asOwner: true, ownerAssertion: true },
  );
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath('/settings');
  return { ok: true, message: 'Granted clients saved.' };
}

export async function setConnectorKillSwitchAction(formData: FormData): Promise<ConnectorActionResult> {
  const refused = await authorized();
  if (refused) return refused;
  const killSwitch = !connectorOnFromForm(formData);
  const result = await adsApi<{ killSwitch: boolean; envForcedOff?: boolean }>(
    '/mcp/connector',
    { method: 'PUT', body: JSON.stringify({ killSwitch }) },
    { asOwner: true, ownerAssertion: true },
  );
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath('/settings');
  if (result.data.envForcedOff === true) {
    return { ok: true, message: 'Saved. MCP_CONNECTOR_KILL_SWITCH is still forcing the connector off.' };
  }
  return { ok: true, message: killSwitch ? 'Connector is off.' : 'Connector is on.' };
}
