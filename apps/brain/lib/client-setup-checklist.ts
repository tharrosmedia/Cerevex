import {
  CAPABILITY_CATALOG,
  CAPABILITY_IDS,
  parseWorkspaceModuleSettings,
  type CapabilityFlags,
} from '@cerevex/contracts';
import {
  ADD_SHOPIFY,
  ADS_CLIENT_DUPLICATE,
  ADS_CLIENT_LINKED,
  ADS_CLIENT_MISSING,
  CALLRAIL_DONE,
  CALLRAIL_MISSING,
  CHECK_PLUGIN,
  CONNECT_CALLRAIL,
  CONNECT_GA4,
  CONNECT_GOOGLE,
  CONNECT_META,
  CONNECT_SEARCH_CONSOLE,
  COULD_NOT_LOAD,
  COULD_NOT_LOAD_ADS,
  COULD_NOT_LOAD_FLAGS,
  FIX_CLIENT_NAME,
  GA4_DONE,
  GA4_LATER,
  GA4_MISSING,
  GOOGLE_CONNECTED,
  GOOGLE_DISCONNECTED,
  GOOGLE_EXPIRING,
  GOOGLE_NEEDS_RECONNECT,
  GOOGLE_NO_ANSWER,
  GOOGLE_NOT_ON_SERVER,
  GOOGLE_PENDING,
  GOOGLE_PERMISSION,
  GOOGLE_RATE_LIMIT,
  GOOGLE_SYNCING,
  META_CONNECTED,
  META_DISCONNECTED,
  META_EXPIRING,
  META_NEEDS_RECONNECT,
  META_NO_ANSWER,
  META_NOT_ON_SERVER,
  META_PENDING,
  META_PERMISSION,
  META_RATE_LIMIT,
  META_SYNCING,
  NAME_THIS_CLIENT,
  PICK_BUSINESS_TYPE,
  RECONNECT_GOOGLE,
  RECONNECT_META,
  SEARCH_CONSOLE_DONE,
  SEARCH_CONSOLE_MISSING,
  SEARCH_CONSOLE_PICK,
  SHOPIFY_CONNECTED,
  SHOPIFY_NOT_CONNECTED,
  SKILLS_LINKED,
  SKILLS_LOADED_NOT_LINKED,
  SKILLS_OWNER_ONLY,
  WORDPRESS_ANSWERING,
  WORDPRESS_NOT_ANSWERING,
  adsClientMismatch,
  loadProfileCta,
  missingFactsSentence,
  sharedFlagsSummary,
  skillProfileLabel,
  skillProfileSlugForName,
} from './ui-copy';

const STORE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same order as ads GET /clients/:id/setup. Connected wins when any account is connected. */
const STATUS_ORDER = [
  'connected',
  'syncing',
  'needs_reconnect',
  'expiring',
  'limited',
  'error',
  'rate_limited',
  'not_configured',
  'pending',
  'disconnected',
] as const;

const STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  syncing: 'Syncing',
  needs_reconnect: 'Needs reconnect',
  expiring: 'Sign-in ending soon',
  limited: 'Missing permission',
  error: 'Not answering',
  rate_limited: 'Slowed down',
  not_configured: 'Not set up',
  pending: 'Sign-in not finished',
  disconnected: 'Not connected',
};

export type SetupAccountInput = {
  externalId: string;
  displayName: string | null;
  status: string;
};

export type SetupAction =
  | { kind: 'continue'; next: string; label: string }
  | { kind: 'skills'; label: string; slug: string | null };

export type SetupDetail = { label: string; value: string };

export type SetupRowModel = {
  id: string;
  title: string;
  required: boolean;
  done: boolean;
  sentence: string;
  action: SetupAction | null;
  details: SetupDetail[];
};

export type ChecklistModel = {
  storeId: string;
  rows: SetupRowModel[];
  done: number;
  total: number;
  progressLabel: string;
  primaryRowId: string | null;
  reconnectHint: string | null;
  adsNotice: string | null;
  sharedFlags: { summary: string; labels: string[] };
  requiredComplete: boolean;
  returnTo: string | null;
};

export type ClientBusinessChoice = 'home_service' | 'ecommerce';

export type ClientSetupChecklistInput = {
  storeId: string;
  storeName: string;
  platform: 'shopify' | 'wordpress';
  shopifyConnected: boolean;
  wordpressAnswering: boolean;
  address: string | null;
  websiteConnectedAt: string | null;
  websiteCheckedAt: string | null;
  businessType: ClientBusinessChoice | null;
  businessTypeLabel: string | null;
  ads:
    | { status: 'unknown' }
    | { status: 'missing' }
    | { status: 'duplicate' }
    | { status: 'linked'; clientId: string | null; name: string };
  metaAccounts: SetupAccountInput[] | null;
  googleAccounts: SetupAccountInput[] | null;
  /** null when /health did not say. false shows the not-set-up sentence. */
  googleConfigured: boolean | null;
  searchConsole: { propertyUrl: string | null; connectedAt: string | null; linked: boolean };
  ga4: { available: false } | { available: true; propertyId: string | null };
  callrailPresent: boolean | null;
  skills:
    | null
    | { status: 'missing'; profileName: string | null }
    | { status: 'loaded'; profileName: string | null }
    | { status: 'linked'; profileName: string | null; missingFacts: number; missingFactLabels: string[] };
  owner: boolean;
  /** null when shared settings did not load. */
  flagsOn: string[] | null;
};

export function formatEt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const text = date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `${text} ET`;
}

export function safeSetupReturn(value: string): string | null {
  if (!/^\/stores\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/setup$/i.test(value)) {
    return null;
  }
  return value;
}

/** Next step after this store is selected. Exact paths only. */
export function safeSetupNext(storeId: string, next: string): string | null {
  if (!STORE_ID.test(storeId)) return null;
  if (next === '/onboarding') return next;
  if (next === '/settings#connects' || next === '/settings#callrail' || next === '/ads/funnel') return next;
  if (next === `/stores/${storeId}/edit`) return next;
  if (next === `/stores/${storeId}/setup`) return next;
  if (next === `/api/gsc/oauth/start?storeId=${storeId}`) return next;
  if (next === '/api/ads/connect?platform=meta' || next === '/api/ads/connect?platform=google') return next;
  const connect = /^\/api\/ads\/connect\?platform=(meta|google)&clientId=([0-9a-f-]{36})$/i.exec(next);
  if (connect && STORE_ID.test(connect[2] ?? '')) return next;
  return null;
}

export function sharedFlagLabels(flags: CapabilityFlags | null): string[] | null {
  if (!flags) return null;
  const labels: string[] = [];
  for (const id of CAPABILITY_IDS) {
    if (flags[id] === 'on') labels.push(CAPABILITY_CATALOG[id].label);
  }
  return labels;
}

function asRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function publicHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).host || null;
    } catch {
      return null;
    }
  }
  if (/[/?#]/.test(trimmed)) return null;
  return trimmed;
}

export function readStoreSetupFacts(store: {
  name?: string | null;
  shopify_domain?: string | null;
  platform?: string | null;
  connector_type?: string | null;
  config?: unknown;
  shopifyTokenPresent: boolean;
}): Pick<
  ClientSetupChecklistInput,
  | 'platform'
  | 'shopifyConnected'
  | 'wordpressAnswering'
  | 'address'
  | 'websiteConnectedAt'
  | 'websiteCheckedAt'
  | 'businessType'
  | 'businessTypeLabel'
  | 'searchConsole'
  | 'ga4'
> {
  const platform = (store.connector_type || store.platform) === 'wordpress' ? 'wordpress' : 'shopify';
  const config = asRecord(store.config);
  const shopify = asRecord(config.shopify);
  const wordpress = asRecord(config.wordpress);
  const gsc = asRecord(config.gsc);
  const keyPresent = typeof wordpress.pluginKeyEnc === 'string' && wordpress.pluginKeyEnc.length > 0;
  const health = typeof wordpress.lastHealthOk === 'boolean' ? wordpress.lastHealthOk : null;
  const business = parseWorkspaceModuleSettings(config.workspace).businessType;
  const businessType = business === 'home_service' || business === 'ecommerce' ? business : null;
  const propertyUrl = typeof gsc.propertyUrl === 'string' && gsc.propertyUrl.trim() ? gsc.propertyUrl.trim() : null;
  const siteUrl = typeof wordpress.siteUrl === 'string' ? wordpress.siteUrl : null;
  return {
    platform,
    shopifyConnected: store.shopifyTokenPresent && shopify.status !== 'not_connected',
    wordpressAnswering: (keyPresent || store.shopifyTokenPresent) && health !== false,
    address: publicHost(platform === 'wordpress' ? siteUrl || store.shopify_domain : store.shopify_domain),
    websiteConnectedAt: typeof wordpress.connectedAt === 'string' ? wordpress.connectedAt : null,
    websiteCheckedAt: typeof wordpress.lastHealthAt === 'string' ? wordpress.lastHealthAt : null,
    businessType,
    businessTypeLabel: businessType === 'home_service' ? 'Home-service business' : businessType === 'ecommerce' ? 'Online store' : null,
    searchConsole: {
      propertyUrl,
      connectedAt: typeof gsc.connectedAt === 'string' ? gsc.connectedAt : null,
      linked: typeof gsc.refreshTokenEnc === 'string' && gsc.refreshTokenEnc.length > 0,
    },
    // Slice 2 PR 2.1 owns the per-store GA4 property. Until then the row waits.
    ga4: { available: false },
  };
}

function rollupStatus(statuses: string[]): string {
  if (statuses.length === 0) return 'disconnected';
  for (const status of STATUS_ORDER) {
    if (statuses.includes(status)) return status;
  }
  return statuses[0] ?? 'disconnected';
}

function continueTo(next: string, label: string): SetupAction {
  return { kind: 'continue', next, label };
}

function timed(details: SetupDetail[], label: string, value: string | null): void {
  const formatted = formatEt(value);
  if (formatted) details.push({ label, value: formatted });
}

function accountDetails(accounts: SetupAccountInput[]): SetupDetail[] {
  const details: SetupDetail[] = [];
  for (const account of accounts) {
    details.push({ label: 'Account', value: account.displayName?.trim() || 'Ad account' });
    details.push({ label: 'Status', value: STATUS_LABELS[account.status] ?? 'Unknown' });
    if (account.externalId.trim()) details.push({ label: 'Account id', value: account.externalId.trim() });
  }
  return details;
}

function anyNeedsReconnect(accounts: SetupAccountInput[] | null): boolean {
  return Boolean(accounts?.some((account) => account.status === 'needs_reconnect'));
}

function connectPath(platform: 'meta' | 'google', clientId: string | null): string {
  const base = `/api/ads/connect?platform=${platform}`;
  return clientId && STORE_ID.test(clientId) ? `${base}&clientId=${clientId}` : base;
}

type PlatformCopy = {
  connected: string;
  disconnected: string;
  syncing: string;
  needsReconnect: string;
  expiring: string;
  limited: string;
  error: string;
  rateLimited: string;
  notConfigured: string;
  pending: string;
  connect: string;
  reconnect: string;
};

const META_COPY: PlatformCopy = {
  connected: META_CONNECTED,
  disconnected: META_DISCONNECTED,
  syncing: META_SYNCING,
  needsReconnect: META_NEEDS_RECONNECT,
  expiring: META_EXPIRING,
  limited: META_PERMISSION,
  error: META_NO_ANSWER,
  rateLimited: META_RATE_LIMIT,
  notConfigured: META_NOT_ON_SERVER,
  pending: META_PENDING,
  connect: CONNECT_META,
  reconnect: RECONNECT_META,
};

const GOOGLE_COPY: PlatformCopy = {
  connected: GOOGLE_CONNECTED,
  disconnected: GOOGLE_DISCONNECTED,
  syncing: GOOGLE_SYNCING,
  needsReconnect: GOOGLE_NEEDS_RECONNECT,
  expiring: GOOGLE_EXPIRING,
  limited: GOOGLE_PERMISSION,
  error: GOOGLE_NO_ANSWER,
  rateLimited: GOOGLE_RATE_LIMIT,
  notConfigured: GOOGLE_NOT_ON_SERVER,
  pending: GOOGLE_PENDING,
  connect: CONNECT_GOOGLE,
  reconnect: RECONNECT_GOOGLE,
};

function platformSentence(copy: PlatformCopy, status: string): { sentence: string; next: 'connect' | 'reconnect' | null } {
  switch (status) {
    case 'connected':
      return { sentence: copy.connected, next: null };
    case 'syncing':
      return { sentence: copy.syncing, next: null };
    case 'needs_reconnect':
      return { sentence: copy.needsReconnect, next: 'reconnect' };
    case 'expiring':
      return { sentence: copy.expiring, next: 'reconnect' };
    case 'limited':
      return { sentence: copy.limited, next: 'reconnect' };
    case 'error':
      return { sentence: copy.error, next: 'reconnect' };
    case 'rate_limited':
      return { sentence: copy.rateLimited, next: null };
    case 'not_configured':
      return { sentence: copy.notConfigured, next: null };
    case 'pending':
      return { sentence: copy.pending, next: 'connect' };
    default:
      return { sentence: copy.disconnected, next: 'connect' };
  }
}

function row(input: SetupRowModel): SetupRowModel {
  return input;
}

function websiteRow(input: ClientSetupChecklistInput): SetupRowModel {
  const details: SetupDetail[] = [];
  if (input.address) details.push({ label: 'Address', value: input.address });
  timed(details, 'Connected', input.websiteConnectedAt);
  timed(details, 'Last check', input.websiteCheckedAt);
  if (input.platform === 'wordpress') {
    const done = input.wordpressAnswering;
    return row({
      id: 'website',
      title: 'Website',
      required: true,
      done,
      sentence: done ? WORDPRESS_ANSWERING : WORDPRESS_NOT_ANSWERING,
      action: done ? null : continueTo('/settings#connects', CHECK_PLUGIN),
      details,
    });
  }
  const done = input.shopifyConnected;
  return row({
    id: 'website',
    title: 'Website',
    required: true,
    done,
    sentence: done ? SHOPIFY_CONNECTED : SHOPIFY_NOT_CONNECTED,
    action: done ? null : continueTo(`/stores/${input.storeId}/edit`, ADD_SHOPIFY),
    details,
  });
}

function businessRow(input: ClientSetupChecklistInput): SetupRowModel {
  const done = Boolean(input.businessType && input.businessTypeLabel);
  return row({
    id: 'business_type',
    title: 'Business type',
    required: true,
    done,
    sentence: done ? input.businessTypeLabel! : PICK_BUSINESS_TYPE,
    action: done ? null : continueTo('/onboarding', PICK_BUSINESS_TYPE),
    details: [],
  });
}

function adsClientRow(input: ClientSetupChecklistInput): SetupRowModel {
  const base = { id: 'ads_client', title: 'Ads client', required: true, details: [] as SetupDetail[] };
  if (input.ads.status === 'unknown') {
    return row({ ...base, done: false, sentence: COULD_NOT_LOAD, action: null });
  }
  if (input.ads.status === 'duplicate') {
    return row({ ...base, done: false, sentence: ADS_CLIENT_DUPLICATE, action: null });
  }
  if (input.ads.status === 'missing') {
    return row({
      ...base,
      done: false,
      sentence: ADS_CLIENT_MISSING,
      action: continueTo(`/stores/${input.storeId}/edit`, NAME_THIS_CLIENT),
    });
  }
  const name = input.ads.name.trim();
  const matches = name.length > 0 && name === input.storeName.trim();
  if (!matches) {
    return row({
      ...base,
      done: false,
      sentence: adsClientMismatch(name || 'Untitled'),
      action: continueTo(`/stores/${input.storeId}/edit`, FIX_CLIENT_NAME),
    });
  }
  return row({
    ...base,
    done: true,
    sentence: ADS_CLIENT_LINKED,
    action: null,
    details: [{ label: 'Name', value: name }],
  });
}

function platformRow(
  input: ClientSetupChecklistInput,
  id: 'meta' | 'google',
  title: string,
  accounts: SetupAccountInput[] | null,
  copy: PlatformCopy,
  required: boolean,
): SetupRowModel {
  const clientId = input.ads.status === 'linked' ? input.ads.clientId : null;
  if (id === 'google' && input.googleConfigured === false && rollupStatus((accounts ?? []).map((account) => account.status)) !== 'connected') {
    return row({
      id,
      title,
      required,
      done: false,
      sentence: GOOGLE_NOT_ON_SERVER,
      action: null,
      details: accounts ? accountDetails(accounts) : [],
    });
  }
  if (!accounts) {
    return row({ id, title, required, done: false, sentence: COULD_NOT_LOAD, action: null, details: [] });
  }
  const status = rollupStatus(accounts.map((account) => account.status));
  const spoken = platformSentence(copy, status);
  const done = status === 'connected';
  let next = spoken.next;
  if (done && anyNeedsReconnect(accounts)) next = 'reconnect';
  const action = next
    ? continueTo(connectPath(id, clientId), next === 'reconnect' ? copy.reconnect : copy.connect)
    : null;
  return row({
    id,
    title,
    required,
    done,
    sentence: spoken.sentence,
    action,
    details: accountDetails(accounts),
  });
}

function searchConsoleRow(input: ClientSetupChecklistInput): SetupRowModel {
  const property = input.searchConsole.propertyUrl;
  const details: SetupDetail[] = [];
  if (property) details.push({ label: 'Property id', value: property });
  timed(details, 'Connected', input.searchConsole.connectedAt);
  if (property) {
    return row({
      id: 'search_console',
      title: 'Search Console',
      required: false,
      done: true,
      sentence: SEARCH_CONSOLE_DONE,
      action: null,
      details,
    });
  }
  const linked = input.searchConsole.linked;
  return row({
    id: 'search_console',
    title: 'Search Console',
    required: false,
    done: false,
    sentence: linked ? SEARCH_CONSOLE_PICK : SEARCH_CONSOLE_MISSING,
    action: continueTo(
      linked ? '/settings#connects' : `/api/gsc/oauth/start?storeId=${input.storeId}`,
      CONNECT_SEARCH_CONSOLE,
    ),
    details,
  });
}

function ga4Row(input: ClientSetupChecklistInput): SetupRowModel {
  if (!input.ga4.available) {
    return row({
      id: 'ga4',
      title: 'GA4',
      required: false,
      done: false,
      sentence: GA4_LATER,
      action: null,
      details: [],
    });
  }
  const propertyId = input.ga4.propertyId?.trim() || null;
  if (!propertyId) {
    return row({
      id: 'ga4',
      title: 'GA4',
      required: false,
      done: false,
      sentence: GA4_MISSING,
      action: continueTo('/ads/funnel', CONNECT_GA4),
      details: [],
    });
  }
  return row({
    id: 'ga4',
    title: 'GA4',
    required: false,
    done: true,
    sentence: GA4_DONE,
    action: null,
    details: [{ label: 'Property id', value: propertyId }],
  });
}

function callrailRow(input: ClientSetupChecklistInput): SetupRowModel | null {
  if (input.businessType !== 'home_service') return null;
  if (input.callrailPresent === null) {
    return row({
      id: 'callrail',
      title: 'CallRail',
      required: false,
      done: false,
      sentence: COULD_NOT_LOAD,
      action: null,
      details: [],
    });
  }
  const done = input.callrailPresent;
  return row({
    id: 'callrail',
    title: 'CallRail',
    required: false,
    done,
    sentence: done ? CALLRAIL_DONE : CALLRAIL_MISSING,
    action: done ? null : continueTo('/settings#callrail', CONNECT_CALLRAIL),
    details: [],
  });
}

function skillsRow(input: ClientSetupChecklistInput): SetupRowModel {
  const base = { id: 'skills', title: 'Skills profile', required: true };
  if (!input.skills) {
    return row({ ...base, done: false, sentence: COULD_NOT_LOAD, action: null, details: [] });
  }
  if (input.skills.status === 'linked') {
    const count = input.skills.missingFacts;
    const sentence = count > 0 ? `${SKILLS_LINKED} ${missingFactsSentence(count)}` : SKILLS_LINKED;
    return row({
      ...base,
      done: true,
      sentence,
      action: null,
      details: input.skills.missingFactLabels.map((label) => ({ label: 'Missing fact', value: label })),
    });
  }
  const name = input.skills.profileName;
  const label = loadProfileCta(name);
  const slug = name ? skillProfileSlugForName(name) : null;
  if (!input.owner) {
    const waiting = input.skills.status === 'loaded' ? SKILLS_LOADED_NOT_LINKED : label;
    return row({
      ...base,
      done: false,
      sentence: `${waiting} ${SKILLS_OWNER_ONLY}`,
      action: null,
      details: [],
    });
  }
  return row({
    ...base,
    done: false,
    sentence: input.skills.status === 'loaded' ? SKILLS_LOADED_NOT_LINKED : label,
    action: { kind: 'skills', label, slug },
    details: [],
  });
}

function reconnectHint(input: ClientSetupChecklistInput): string | null {
  const parts: string[] = [];
  if (anyNeedsReconnect(input.metaAccounts)) parts.push(META_NEEDS_RECONNECT);
  if (anyNeedsReconnect(input.googleAccounts)) parts.push(GOOGLE_NEEDS_RECONNECT);
  return parts.length ? parts.join(' ') : null;
}

export function buildClientSetupChecklist(input: ClientSetupChecklistInput): ChecklistModel {
  const rows = [
    websiteRow(input),
    businessRow(input),
    adsClientRow(input),
    platformRow(input, 'meta', 'Meta', input.metaAccounts, META_COPY, true),
    platformRow(input, 'google', 'Google Ads', input.googleAccounts, GOOGLE_COPY, false),
    searchConsoleRow(input),
    ga4Row(input),
    callrailRow(input),
    skillsRow(input),
  ].filter((item): item is SetupRowModel => item !== null);
  const done = rows.filter((item) => item.done).length;
  const firstGap = rows.find((item) => item.required && !item.done);
  const flags = input.flagsOn;
  return {
    storeId: input.storeId,
    rows,
    done,
    total: rows.length,
    progressLabel: `${done} of ${rows.length} done`,
    primaryRowId: firstGap?.action ? firstGap.id : null,
    reconnectHint: reconnectHint(input),
    adsNotice: input.metaAccounts === null && input.ads.status !== 'duplicate' ? COULD_NOT_LOAD_ADS : null,
    sharedFlags: flags
      ? { summary: sharedFlagsSummary(flags), labels: flags }
      : { summary: COULD_NOT_LOAD_FLAGS, labels: [] },
    requiredComplete: rows.filter((item) => item.required).every((item) => item.done),
    returnTo: safeSetupReturn(`/stores/${input.storeId}/setup`),
  };
}

export function suggestedSkillProfile(names: Array<string | null | undefined>): { slug: string | null; label: string | null } {
  for (const name of names) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const slug = skillProfileSlugForName(trimmed);
    if (slug) return { slug, label: skillProfileLabel(slug) };
  }
  return { slug: null, label: null };
}
