import { normalizeSiteUrl } from '@cerevex/connector-wordpress';
import { settingsJsonWithBusinessType } from '@cerevex/contracts';
import {
  emptyClientWorkspaceConfig,
  isClientBusinessType,
  type ClientBusinessType,
} from '@/src/lib/db/client-workspace';
import { normalizeShopDomain } from '@/src/lib/shopify/verify';
import {
  WORDPRESS_CONNECT_OFF_REASON,
} from '@/src/lib/wordpress/connect-copy';
import {
  alreadyAClient,
  alreadyClientUse,
  CLIENT_NAME_TOO_LONG,
  ENTER_CLIENT_NAME,
  ENTER_STORE_ADDRESS,
  PASTE_ADMIN_TOKEN_REQUIRED,
  PICK_BUSINESS_TYPE,
  siteAlreadyLinked,
  SKILL_PROFILE_ALIASES,
  skillProfileSlugForName,
  storeAddressTaken,
  TYPE_A_DIFFERENT_NAME,
  WORDPRESS_UNREACHABLE,
} from '@/lib/ui-copy';

export { WORDPRESS_CONNECT_OFF_REASON };

/** Checklist contract: config.shopify.status for a row with no token. */
export const SHOPIFY_CONNECT_LATER_STATUS = 'not_connected';

const CLIENT_NAME_MAX = 200;

const HREF_KEYS = ['step', 'name', 'business', 'platform', 'match', 'msg'] as const;

export type AddClientHrefParams = Partial<Record<(typeof HREF_KEYS)[number], string | undefined>>;

export function addClientHref(params: AddClientHrefParams = {}): string {
  const qs = new URLSearchParams();
  qs.set('flow', '1');
  for (const key of HREF_KEYS) {
    const value = params[key];
    if (value) qs.set(key, value);
  }
  return `/stores?${qs.toString()}#add`;
}

export function normalizeClientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export type ProfileSite = { name: string };
export type ProfileClient = { name: string; siteId?: string | null };

function nameKey(name: string): string {
  return normalizeClientName(name).toLowerCase();
}

/** Primary labels of Skills profiles that are not already on a store or a linked ads client. */
export function skillProfileSuggestions(input: {
  stores: ProfileSite[];
  clients: ProfileClient[];
}): string[] {
  const linked = new Set<string>();
  for (const store of input.stores) linked.add(nameKey(store.name));
  for (const client of input.clients) {
    if (!client.siteId) continue;
    linked.add(nameKey(client.name));
  }
  const suggestions: string[] = [];
  for (const aliases of Object.values(SKILL_PROFILE_ALIASES)) {
    const taken = aliases.some((alias) => linked.has(nameKey(alias)));
    if (!taken) suggestions.push(aliases[0]);
  }
  return suggestions;
}

export function profileFoundForName(name: string, suggestions: readonly string[]): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return suggestions.some((suggestion) => {
    const slug = skillProfileSlugForName(suggestion);
    const aliases = slug ? SKILL_PROFILE_ALIASES[slug] : [suggestion];
    return aliases.some((alias) => nameKey(alias) === key);
  });
}

export type NamedStore = {
  name: string;
  shopify_domain: string;
  platform?: string | null;
  connector_type?: string | null;
};

export function namedStores(rows: readonly unknown[]): NamedStore[] {
  const stores: NamedStore[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.shopify_domain !== 'string') continue;
    stores.push({
      name: record.name,
      shopify_domain: record.shopify_domain,
      platform: typeof record.platform === 'string' ? record.platform : null,
      connector_type: typeof record.connector_type === 'string' ? record.connector_type : null,
    });
  }
  return stores;
}

export function matchingShopifyDomain(stores: NamedStore[], domain: string): NamedStore | null {
  const normalized = normalizeShopDomain(domain);
  if (!normalized) return null;
  return stores.find((store) => normalizeShopDomain(store.shopify_domain) === normalized) ?? null;
}

export function siteAddressKey(raw: string): string {
  return normalizeSiteUrl(raw).toLowerCase();
}

export function matchingWordpressSite(stores: NamedStore[], siteUrl: string): NamedStore | null {
  const key = siteAddressKey(siteUrl);
  if (!key) return null;
  return stores.find((store) => {
    const wordpress = (store.connector_type || store.platform) === 'wordpress';
    return wordpress && siteAddressKey(store.shopify_domain) === key;
  }) ?? null;
}

export function clientWorkspaceRecord(businessType: ClientBusinessType, completedAt?: string): Record<string, unknown> {
  const base = emptyClientWorkspaceConfig();
  return settingsJsonWithBusinessType(base.workspace, businessType, completedAt);
}

export function shopifyAddConfig(input: {
  businessType: ClientBusinessType;
  connectLater: boolean;
  completedAt?: string;
}): { workspace: Record<string, unknown>; shopify?: { status: typeof SHOPIFY_CONNECT_LATER_STATUS } } {
  const workspace = clientWorkspaceRecord(input.businessType, input.completedAt);
  if (!input.connectLater) return { workspace };
  return { workspace, shopify: { status: SHOPIFY_CONNECT_LATER_STATUS } };
}

type IdentityClient = { name: string; siteId?: string | null };

export type IdentityDecision =
  | { ok: true; name: string; businessType: ClientBusinessType; adopt: boolean }
  | { ok: false; code: 'name' | 'business' | 'linked' | 'choose-existing' | 'type-new'; message: string; existingName?: string };

function clientNamed(clients: IdentityClient[], name: string, linked: boolean): IdentityClient | null {
  const key = nameKey(name);
  if (!key) return null;
  return clients.find((client) => {
    const hasSite = Boolean(client.siteId);
    return hasSite === linked && nameKey(client.name) === key;
  }) ?? null;
}

export function decideClientIdentity(input: {
  name: string;
  businessType: unknown;
  choice: 'continue' | 'use' | 'new';
  clients: IdentityClient[];
}): IdentityDecision {
  const name = normalizeClientName(input.name);
  if (!name) return { ok: false, code: 'name', message: ENTER_CLIENT_NAME };
  if (name.length > CLIENT_NAME_MAX) return { ok: false, code: 'name', message: CLIENT_NAME_TOO_LONG };
  if (!isClientBusinessType(input.businessType)) {
    return { ok: false, code: 'business', message: PICK_BUSINESS_TYPE };
  }

  const linked = clientNamed(input.clients, name, true);
  if (linked) return { ok: false, code: 'linked', message: alreadyAClient(linked.name) };

  const existing = clientNamed(input.clients, name, false);
  if (existing && input.choice === 'new') {
    return { ok: false, code: 'type-new', message: `${TYPE_A_DIFFERENT_NAME} ${alreadyAClient(existing.name)}` };
  }
  if (existing && input.choice !== 'use') {
    return {
      ok: false,
      code: 'choose-existing',
      message: alreadyClientUse(existing.name),
      existingName: existing.name,
    };
  }

  return {
    ok: true,
    name: existing && input.choice === 'use' ? existing.name : name,
    businessType: input.businessType,
    adopt: Boolean(existing && input.choice === 'use'),
  };
}

export type ShopifyAddPlan =
  | { ok: false; message: string }
  | {
      ok: true;
      mode: 'later' | 'paste';
      name: string;
      domain: string;
      token: string | null;
      businessType: ClientBusinessType;
      config: ReturnType<typeof shopifyAddConfig>;
    };

export function planShopifyAdd(input: {
  name: string;
  businessType: unknown;
  domain: string;
  token: string;
  connect: 'later' | 'paste';
  stores: NamedStore[];
  completedAt?: string;
}): ShopifyAddPlan {
  const name = normalizeClientName(input.name);
  if (!name) return { ok: false, message: ENTER_CLIENT_NAME };
  if (!isClientBusinessType(input.businessType)) return { ok: false, message: PICK_BUSINESS_TYPE };
  const domain = normalizeShopDomain(input.domain);
  if (!domain) return { ok: false, message: ENTER_STORE_ADDRESS };
  const taken = matchingShopifyDomain(input.stores, domain);
  if (taken) return { ok: false, message: storeAddressTaken(taken.name) };
  const token = input.token.trim();
  if (input.connect === 'paste' && !token) return { ok: false, message: PASTE_ADMIN_TOKEN_REQUIRED };
  const connectLater = input.connect !== 'paste' || !token;
  return {
    ok: true,
    mode: connectLater ? 'later' : 'paste',
    name,
    domain,
    token: connectLater ? null : token,
    businessType: input.businessType,
    config: shopifyAddConfig({
      businessType: input.businessType,
      connectLater,
      completedAt: input.completedAt,
    }),
  };
}

export type WordpressAddPlan =
  | { ok: false; message: string }
  | { ok: true; siteUrl: string };

export function planWordpressAdd(input: { siteUrl: string; stores: NamedStore[] }): WordpressAddPlan {
  const existing = matchingWordpressSite(input.stores, input.siteUrl);
  if (existing) return { ok: false, message: siteAlreadyLinked(existing.name) };
  return { ok: true, siteUrl: normalizeSiteUrl(input.siteUrl) };
}

export function wordpressConnectFailureMessage(result: { code?: string; reason?: string }): string {
  if (result.code === 'unreachable' || result.code === 'plugin_down') return WORDPRESS_UNREACHABLE;
  if (result.code === 'capability_off') return WORDPRESS_CONNECT_OFF_REASON;
  return result.reason || 'Could not connect the site.';
}

export function setupHref(storeId: string, warn?: string): string {
  if (!warn) return `/stores/${storeId}/setup`;
  return `/stores/${storeId}/setup?${new URLSearchParams({ warn }).toString()}`;
}
