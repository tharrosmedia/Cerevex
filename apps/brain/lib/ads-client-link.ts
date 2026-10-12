import {
  ensureSiteClient,
  listAdsClients,
  renameAdsClient,
  type AdsClient,
  type AdsResult,
} from './ads-bff';

export function adoptedClientSentence(name: string): string {
  return `There's already a client called ${name}. Linked that one.`;
}

/** Name the ads client and link it to this site. One site, one client. An unlinked same name is adopted. */
export function nameAndLinkSiteClient(siteId: string, name: string) {
  return ensureSiteClient(siteId, name.trim());
}

type ClientList = AdsResult<{ clients: AdsClient[] }>;
type Renamed = AdsResult<{ client: AdsClient }>;
type Ensured = AdsResult<{ client: AdsClient; created: boolean; adopted: boolean }>;

/**
 * Keep the ads client name in step with the store.
 * A name that did not change does not call ads. A linked client is renamed.
 * A site with no client is named and linked. A refused rename leaves the store unchanged.
 */
export async function syncAdsClientOnRename(
  input: {
    siteId: string;
    previousName: string;
    nextName: string;
  },
  deps: {
    listClients?: () => Promise<ClientList>;
    rename?: (clientId: string, name: string) => Promise<Renamed>;
    ensure?: (siteId: string, name: string) => Promise<Ensured>;
  } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const nextName = input.nextName.trim();
  if (!nextName) return { ok: false, message: 'Enter a name.' };
  if (nextName === input.previousName) return { ok: true };

  const listed = await (deps.listClients ?? listAdsClients)();
  if (!listed.ok) return { ok: false, message: listed.message };

  const linked = listed.data.clients.filter((client) => client.siteId === input.siteId);
  if (linked.length > 1) {
    return { ok: false, message: 'This store is linked to more than one ads client.' };
  }

  const current = linked[0];
  if (!current) {
    const ensured = await (deps.ensure ?? ensureSiteClient)(input.siteId, nextName);
    if (!ensured.ok) return { ok: false, message: ensured.message };
    return { ok: true };
  }
  if (current.name === nextName) return { ok: true };

  const renamed = await (deps.rename ?? renameAdsClient)(current.id, nextName);
  if (!renamed.ok) return { ok: false, message: renamed.message };
  return { ok: true };
}
