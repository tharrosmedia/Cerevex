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

export function connectorOffFromForm(formData: FormData): boolean {
  return formData.get('connectorOff') === 'on';
}

export { MCP_SCOPES };
