import { adsApi, listAdsClients } from '@/lib/ads-bff';
import { ConnectorSettings } from '@/components/connector-settings';
import { isMcpScope, type McpScope } from '@cerevex/contracts';
import type { McpIdentityView } from '@/lib/mcp-connector';

function readIdentities(value: unknown): McpIdentityView[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const rows = (value as { identities?: unknown }).identities;
  if (!Array.isArray(rows)) return [];
  const identities: McpIdentityView[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.name !== 'string') continue;
    const scopes = Array.isArray(record.scopes) ? record.scopes.filter((scope): scope is McpScope => typeof scope === 'string' && isMcpScope(scope)) : [];
    const clientIds = Array.isArray(record.clientIds) ? record.clientIds.filter((id): id is string => typeof id === 'string') : [];
    identities.push({
      id: record.id,
      name: record.name,
      scopes,
      clientIds,
      revokedAt: typeof record.revokedAt === 'string' ? record.revokedAt : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    });
  }
  return identities;
}

export async function ConnectorSettingsPanel() {
  try {
    const [connector, identities, clients] = await Promise.all([
      adsApi<{ killSwitch: boolean }>('/mcp/connector', {}, { asOwner: true }),
      adsApi<{ identities: McpIdentityView[] }>('/mcp/identities', {}, { asOwner: true }),
      listAdsClients(),
    ]);
    const loadError = !connector.ok ? connector.message : !identities.ok ? identities.message : null;
    return (
      <ConnectorSettings
        killSwitch={connector.ok && typeof connector.data.killSwitch === 'boolean' ? connector.data.killSwitch : null}
        identities={identities.ok ? readIdentities(identities.data) : []}
        clients={clients.ok ? clients.data.clients.map((client) => ({ id: client.id, name: client.name })) : []}
        loadError={loadError}
      />
    );
  } catch {
    return (
      <ConnectorSettings
        killSwitch={null}
        identities={[]}
        clients={[]}
        loadError="Connector settings could not be loaded."
      />
    );
  }
}
