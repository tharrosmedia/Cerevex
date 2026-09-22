import { adsApi, type AdsAccount, type AdsAudit, type AdsClient, type AdsSuggestion } from './ads-bff';
import { platformFromRecord } from './ads-copy';
import type { AdsFilterState } from '@/components/ads/ads-filters';

export function parseAdsFilters(input: {
  client?: string;
  platform?: string;
  status?: string;
  connect_error?: string;
  connected?: string;
  oauth_error?: string;
}): AdsFilterState & { notice?: string } {
  const platform = input.platform === 'meta' || input.platform === 'google' ? input.platform : undefined;
  const notice = input.connect_error || input.oauth_error
    ? input.connect_error || 'Could not finish connecting that account.'
    : input.connected
      ? `${input.connected === 'google' ? 'Google' : 'Meta'} is connected.`
      : undefined;
  return {
    client: input.client || undefined,
    platform,
    status: input.status || undefined,
    notice,
  };
}

export function pickDefaultClient(clients: AdsClient[], storeName?: string | null, preferred?: string): AdsClient | undefined {
  if (preferred) return clients.find((client) => client.id === preferred);
  if (storeName) {
    const match = clients.find((client) => client.name.toLowerCase() === storeName.toLowerCase());
    if (match) return match;
  }
  if (clients.length === 1) return clients[0];
  return undefined;
}

export async function loadAccounts(clientIds: string[]): Promise<AdsAccount[]> {
  const rows = await Promise.all(
    clientIds.map((id) => adsApi<{ adAccounts: AdsAccount[] }>(`/clients/${id}`)),
  );
  return rows.flatMap((row) => (row.ok ? row.data.adAccounts : []));
}

export function accountPlatform(accounts: AdsAccount[], adAccountId?: string | null): string | null {
  if (!adAccountId) return null;
  return accounts.find((account) => account.id === adAccountId)?.platform ?? null;
}

export function auditPlatform(audit: AdsAudit, accounts: AdsAccount[]): string | null {
  const scoped = typeof audit.summary?.adAccountId === 'string' ? audit.summary.adAccountId : null;
  const fromAccount = accountPlatform(accounts, scoped);
  if (fromAccount) return fromAccount;
  const clientAccounts = accounts.filter((account) => account.clientId === audit.clientId);
  if (clientAccounts.length === 1) return clientAccounts[0].platform;
  return null;
}

export function filterAudits(
  audits: AdsAudit[],
  filters: AdsFilterState,
  accounts: AdsAccount[],
): AdsAudit[] {
  return audits.filter((audit) => {
    if (filters.client && audit.clientId !== filters.client) return false;
    if (filters.status && audit.status !== filters.status) return false;
    if (filters.platform) {
      const platform = auditPlatform(audit, accounts);
      if (platform && platform !== filters.platform) return false;
    }
    return true;
  });
}

export function filterSuggestions(
  suggestions: AdsSuggestion[],
  filters: AdsFilterState,
  accounts: AdsAccount[],
): AdsSuggestion[] {
  return suggestions.filter((suggestion) => {
    if (filters.client && suggestion.clientId !== filters.client) return false;
    if (filters.status && suggestion.status !== filters.status) return false;
    if (filters.platform) {
      const platform =
        platformFromRecord(suggestion.evidence) ?? accountPlatform(accounts, suggestion.adAccountId);
      if (platform && platform !== filters.platform) return false;
    }
    return true;
  });
}

export function clientName(clients: AdsClient[], clientId: string | null | undefined): string {
  if (!clientId) return 'Unknown client';
  return clients.find((client) => client.id === clientId)?.name ?? 'Unknown client';
}

export function lastCompletedAudit(audits: AdsAudit[]): AdsAudit | undefined {
  return audits.find((audit) => audit.status === 'completed') ?? audits[0];
}

export function openSuggestionCount(suggestions: AdsSuggestion[]): number {
  return suggestions.filter((row) => row.status === 'proposed').length;
}
