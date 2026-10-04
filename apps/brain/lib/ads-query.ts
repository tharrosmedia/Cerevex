import {
  SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE,
  SCHOLARSHIP_LOCATION_MESSAGE,
  scholarshipDowngradeAdAccountMessage,
  adAccountLimitMessage,
} from '@cerevex/contracts';
import { adsApi, type AdsAccount, type AdsAudit, type AdsClient, type AdsSuggestion } from './ads-bff';
import { ADS_CHECK_NO_SITE, ADS_CONNECT_NO_CLIENT, ADS_SITE_CLIENT_UNAVAILABLE, platformFromRecord } from './ads-copy';
import type { AdsFilterState } from '@/components/ads/ads-filters';

const OAUTH_ERROR_COPY: Record<string, string> = {
  access_denied: 'Connecting was cancelled on the Meta or Google permission screen. Nothing was connected.',
  missing_code: 'Meta or Google did not send the connection back. Try connecting again.',
  exchange_failed: 'Meta or Google accepted the login, but Cerevex could not finish connecting. Try again.',
  capability_off: 'Connecting ad accounts is turned off for this workspace. Turn it on in Settings, then try again.',
  list_failed: 'Signed in, but Cerevex could not load the ad accounts on that login. Try again in a minute.',
  no_accounts: 'That login has no ad accounts. Sign in with the login that manages this site’s ads.',
  choose_in_console: 'That login has several ad accounts. Connect from the Cerevex console to choose which ones belong to this site.',
  plan_limit:
    'This Scholarship includes 1 ad account on this platform. Disconnect the current one to switch, or move to the paid plan for unlimited ad accounts.',
};

export function oauthErrorMessage(code: string | undefined): string {
  if (!code) return 'Could not finish connecting that account.';
  return OAUTH_ERROR_COPY[code] ?? `Could not finish connecting that account (${code.replace(/_/g, ' ')}).`;
}

const KNOWN_CONNECT_SENTENCES = new Set([
  'Choose Meta or Google.',
  'Could not start Meta connect.',
  'Could not start Google connect.',
  'Could not load your sites.',
  ADS_CHECK_NO_SITE,
  ADS_CONNECT_NO_CLIENT,
  ADS_SITE_CLIENT_UNAVAILABLE,
  SCHOLARSHIP_LOCATION_MESSAGE,
  SCHOLARSHIP_DOWNGRADE_LOCATION_MESSAGE,
  OAUTH_ERROR_COPY.plan_limit,
  adAccountLimitMessage('meta'),
  adAccountLimitMessage('google'),
  scholarshipDowngradeAdAccountMessage('meta'),
  scholarshipDowngradeAdAccountMessage('google'),
]);

const SCHOLARSHIP_ACCOUNT_SENTENCE =
  /^This Scholarship includes 1 .+ Disconnect the current one to switch, or move to the paid plan for unlimited ad accounts\.$/;
const SCHOLARSHIP_DOWNGRADE_SENTENCE =
  /^This account has more than one .+ before moving to the Scholarship\.$/;

/** Query text is shown only when it is one of our own sentences or error codes. */
export function knownConnectError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (OAUTH_ERROR_COPY[value]) return OAUTH_ERROR_COPY[value];
  if (KNOWN_CONNECT_SENTENCES.has(value)) return value;
  if (SCHOLARSHIP_ACCOUNT_SENTENCE.test(value) || SCHOLARSHIP_DOWNGRADE_SENTENCE.test(value)) return value;
  return undefined;
}

export function parseAdsFilters(input: {
  client?: string;
  platform?: string;
    status?: string;
    kind?: string;
    connect_error?: string;
  connected?: string;
  count?: string;
  oauth_error?: string;
}): AdsFilterState & { notice?: string } {
  const platform = input.platform === 'meta' || input.platform === 'google' ? input.platform : undefined;
  const count = Number(input.count);
  const connectedName = input.connected === 'google' ? 'Google Ads' : 'Meta';
  const connectError = knownConnectError(input.connect_error);
  const notice = connectError || input.oauth_error
    ? connectError || oauthErrorMessage(input.oauth_error)
    : input.connected
      ? count > 1
        ? `Connected ${count} ${connectedName} accounts. Their first sync is running.`
        : `${connectedName} is connected. The first sync is running.`
      : undefined;
  return {
    client: input.client || undefined,
    platform,
    status: input.status || undefined,
    kind: input.kind || undefined,
    notice,
  };
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
    if (filters.kind && suggestion.type !== filters.kind) return false;
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
