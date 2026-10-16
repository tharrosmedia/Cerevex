import { isMcpScope, MCP_SCOPES, type McpScope } from '@cerevex/contracts';

const NAME = /^[a-z0-9-]{2,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type McpIdentityView = {
  id: string;
  name: string;
  scopes: McpScope[];
  clientIds: string[];
  revokedAt: string | null;
  createdAt: string;
};

export type ConnectorClient = { id: string; name: string };

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  'cerevex.read': 'Read synced data',
  'cerevex.recs.submit': 'Submit recommendations',
};

export function parseIdentityName(value: unknown): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  return NAME.test(name) ? name : null;
}

export function parseScopes(values: unknown[]): McpScope[] | null {
  const scopes: McpScope[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !isMcpScope(value)) return null;
    if (!scopes.includes(value)) scopes.push(value);
  }
  return scopes.length > 0 ? scopes : null;
}

export function parseClientIds(values: unknown[]): string[] | null {
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !UUID.test(value)) return null;
    if (!ids.includes(value)) ids.push(value);
  }
  return ids;
}

export function parseCreateForm(formData: FormData):
  | { ok: true; body: { name: string; scopes: McpScope[]; clientIds: string[] } }
  | { ok: false; message: string } {
  const name = parseIdentityName(formData.get('name'));
  if (!name) return { ok: false, message: 'Name must be 2 to 40 lowercase letters, digits, or hyphens.' };
  const scopes = parseScopes(formData.getAll('scopes'));
  if (!scopes) return { ok: false, message: 'Choose at least one scope. Only read and submit are allowed.' };
  const clientIds = parseClientIds(formData.getAll('clientIds'));
  if (!clientIds) return { ok: false, message: 'Choose clients from this workspace.' };
  return { ok: true, body: { name, scopes, clientIds } };
}

export const CONNECTOR_OFF_STATUS = 'Off. Connector calls are refused.';
export const CONNECTOR_ON_STATUS = 'On. Connector calls are allowed.';
export const CONNECTOR_UNKNOWN_STATUS = 'Connector status did not load. Calls stay off until this page can read the workspace.';
export const CONNECTOR_ENV_STATUS =
  'Off. MCP_CONNECTOR_KILL_SWITCH is forcing the connector off. Saving the switch cannot turn it on.';

export type ConnectorSwitchView = {
  known: boolean;
  /** Saved workspace flag. True means the owner left the connector off. */
  savedOff: boolean;
  envForcedOff: boolean;
  /** What callers see. Off when the page could not load, the flag is off, or the env override is set. */
  off: boolean;
  status: string;
  canEdit: boolean;
};

/**
 * Saved flag and the env override. Unset on the server arrives as killSwitch true.
 * A load failure is null and stays off, so the page cannot turn the connector on by guess.
 */
export function connectorSwitchView(input: { killSwitch: boolean | null; envForcedOff: boolean }): ConnectorSwitchView {
  if (input.envForcedOff) {
    return {
      known: input.killSwitch !== null,
      savedOff: input.killSwitch !== false,
      envForcedOff: true,
      off: true,
      status: CONNECTOR_ENV_STATUS,
      canEdit: false,
    };
  }
  if (input.killSwitch == null) {
    return {
      known: false,
      savedOff: true,
      envForcedOff: false,
      off: true,
      status: CONNECTOR_UNKNOWN_STATUS,
      canEdit: false,
    };
  }
  const savedOff = input.killSwitch !== false;
  return {
    known: true,
    savedOff,
    envForcedOff: false,
    off: savedOff,
    status: savedOff ? CONNECTOR_OFF_STATUS : CONNECTOR_ON_STATUS,
    canEdit: true,
  };
}

/** Checked checkbox means the owner wants the connector on. A missing field stays off. */
export function connectorOnFromForm(formData: FormData): boolean {
  return formData.get('connectorOn') === 'on';
}

export { MCP_SCOPES };
