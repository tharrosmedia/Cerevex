import { adsApi, getClientSetup, type AdsClient, type ClientSetupSummary } from './ads-bff';
import {
  buildClientSetupChecklist,
  readStoreSetupFacts,
  sharedFlagLabels,
  suggestedSkillProfile,
  type ChecklistModel,
  type ClientSetupChecklistInput,
  type SetupAccountInput,
} from './client-setup-checklist';
import { bundledMissingFactLabels } from './skill-missing-facts';
import { skillProfileLabel } from './ui-copy';
import { getWorkspaceProductSettings } from '@/src/lib/db/workspace-modules';

export type SetupStoreSource = {
  id: string;
  name: string;
  shopify_domain?: string | null;
  platform?: string | null;
  connector_type?: string | null;
  config?: unknown;
  shopify_access_token?: string | null;
  has_shopify_token?: unknown;
};

type StoreRow = {
  id?: unknown;
  name?: unknown;
  shopify_domain?: unknown;
  platform?: unknown;
  connector_type?: unknown;
  config?: unknown;
  shopify_access_token?: unknown;
  has_shopify_token?: unknown;
};

function asStore(store: StoreRow): SetupStoreSource | null {
  if (typeof store.id !== 'string' || !store.id || typeof store.name !== 'string') return null;
  return {
    id: store.id,
    name: store.name,
    shopify_domain: typeof store.shopify_domain === 'string' ? store.shopify_domain : null,
    platform: typeof store.platform === 'string' ? store.platform : null,
    connector_type: typeof store.connector_type === 'string' ? store.connector_type : null,
    config: store.config,
    shopify_access_token: typeof store.shopify_access_token === 'string' ? store.shopify_access_token : null,
    has_shopify_token: store.has_shopify_token,
  };
}

type HealthBody = {
  oauth?: { google?: { configured?: boolean } };
};

function tokenPresent(store: SetupStoreSource): boolean {
  if (typeof store.shopify_access_token === 'string') return store.shopify_access_token.trim().length > 0;
  return store.has_shopify_token === true || store.has_shopify_token === 't' || store.has_shopify_token === 'true';
}

function googleConfiguredFrom(data: unknown): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const configured = (data as HealthBody).oauth?.google?.configured;
  return typeof configured === 'boolean' ? configured : null;
}

function asAccounts(value: unknown): SetupAccountInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { externalId?: unknown; displayName?: unknown; status?: unknown };
    if (typeof row.externalId !== 'string' || typeof row.status !== 'string') return [];
    return [{
      externalId: row.externalId,
      displayName: typeof row.displayName === 'string' ? row.displayName : null,
      status: row.status,
    }];
  });
}

async function readGoogleConfigured(): Promise<boolean | null> {
  const health = await adsApi<HealthBody>('/health', {}, { anonymous: true });
  return googleConfiguredFrom(health.ok ? health.data : health.data);
}

async function readClients(): Promise<AdsClient[] | null> {
  const listed = await adsApi<{ clients: AdsClient[] }>('/clients');
  return listed.ok ? listed.data.clients : null;
}

function matchClient(clients: AdsClient[] | null, storeId: string): AdsClient | 'unknown' | 'missing' | 'duplicate' {
  if (!clients) return 'unknown';
  const matches = clients.filter((client) => client.siteId === storeId);
  if (matches.length === 0) return 'missing';
  if (matches.length > 1 || !matches[0]) return 'duplicate';
  return matches[0];
}

function skillsInput(
  body: ClientSetupSummary | null,
  names: Array<string | null | undefined>,
): ClientSetupChecklistInput['skills'] {
  const suggested = suggestedSkillProfile(names);
  if (!body?.skills) return { status: 'missing', profileName: suggested.label };
  const slug = typeof body.skills.slug === 'string' && body.skills.slug ? body.skills.slug : suggested.slug;
  const label = skillProfileLabel(slug) ?? suggested.label;
  if (body.skills.linked) {
    const missingFacts = typeof body.skills.missingFacts === 'number' ? body.skills.missingFacts : 0;
    const bundled = slug ? bundledMissingFactLabels(slug) : [];
    return {
      status: 'linked',
      profileName: label,
      missingFacts,
      missingFactLabels: bundled.length > 0 && bundled.length === missingFacts ? bundled : [],
    };
  }
  if (body.skills.loaded) return { status: 'loaded', profileName: label };
  return { status: 'missing', profileName: label };
}

function checklistInput(
  store: SetupStoreSource,
  owner: boolean,
  flagsOn: string[] | null,
  googleConfigured: boolean | null,
  client: AdsClient | 'unknown' | 'missing' | 'duplicate',
  setup: ClientSetupSummary | null,
  setupFailed: boolean,
): ClientSetupChecklistInput {
  const facts = readStoreSetupFacts({ ...store, shopifyTokenPresent: tokenPresent(store) });
  const clientName = setup?.name ?? (typeof client === 'object' ? client.name : null);
  const profileNames = [clientName, store.name];
  let ads: ClientSetupChecklistInput['ads'];
  if (client === 'unknown') ads = { status: 'unknown' };
  else if (client === 'missing') ads = { status: 'missing' };
  else if (client === 'duplicate') ads = { status: 'duplicate' };
  else ads = { status: 'linked', clientId: client.id, name: clientName ?? client.name };
  const unavailable = client === 'unknown' || client === 'duplicate' || setupFailed;
  return {
    storeId: store.id,
    storeName: store.name,
    ...facts,
    ads,
    metaAccounts: unavailable ? null : asAccounts(setup?.accounts?.meta),
    googleAccounts: unavailable ? null : asAccounts(setup?.accounts?.google),
    googleConfigured,
    callrailPresent: unavailable ? null : Boolean(setup?.callrail?.present),
    skills: unavailable ? null : skillsInput(setup, profileNames),
    owner,
    flagsOn,
  };
}

export async function loadChecklistForStore(store: StoreRow, owner: boolean): Promise<ChecklistModel> {
  const source = asStore(store);
  if (!source) throw new Error('Could not load this store.');
  return loadChecklistFromSource(source, owner);
}

async function loadChecklistFromSource(store: SetupStoreSource, owner: boolean): Promise<ChecklistModel> {
  const [flags, googleConfigured, clients] = await Promise.all([
    loadFlagLabels(),
    readGoogleConfigured(),
    readClients(),
  ]);
  const client = matchClient(clients, store.id);
  let setup: ClientSetupSummary | null = null;
  let setupFailed = false;
  if (typeof client === 'object') {
    const result = await getClientSetup(client.id);
    setupFailed = !result.ok;
    setup = result.ok ? result.data : null;
  }
  return buildClientSetupChecklist(checklistInput(store, owner, flags, googleConfigured, client, setup, setupFailed));
}

export async function loadSetupProgress(stores: StoreRow[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const sources = stores.flatMap((store) => {
    const source = asStore(store);
    return source ? [source] : [];
  });
  if (sources.length === 0) return labels;
  const [flags, googleConfigured, clients] = await Promise.all([
    loadFlagLabels(),
    readGoogleConfigured(),
    readClients(),
  ]);
  const setups = new Map<string, { ok: boolean; body: ClientSetupSummary | null }>();
  const ids = [...new Set(sources.flatMap((store) => {
    const client = matchClient(clients, store.id);
    return typeof client === 'object' ? [client.id] : [];
  }))];
  await Promise.all(ids.map(async (id) => {
    const result = await getClientSetup(id);
    setups.set(id, { ok: result.ok, body: result.ok ? result.data : null });
  }));
  for (const store of sources) {
    const client = matchClient(clients, store.id);
    const fetched = typeof client === 'object' ? setups.get(client.id) : undefined;
    const model = buildClientSetupChecklist(checklistInput(
      store,
      false,
      flags,
      googleConfigured,
      client,
      fetched?.body ?? null,
      typeof client === 'object' ? !fetched?.ok : false,
    ));
    labels.set(store.id, model.progressLabel);
  }
  return labels;
}

async function loadFlagLabels(): Promise<string[] | null> {
  try {
    const settings = await getWorkspaceProductSettings();
    return sharedFlagLabels(settings.capabilities);
  } catch {
    return null;
  }
}
