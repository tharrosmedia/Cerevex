import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultCapabilityFlags } from '@cerevex/contracts';
import { SKILL_CLIENT_ALIASES } from '../../ads/shared/src/skill-client-aliases';
import {
  META_PERMISSION_MESSAGE,
  META_RATE_LIMIT_MESSAGE,
  META_RECONNECT_MESSAGE,
} from '../../ads/shared/src/meta-graph-error';
import { ClientSetupChecklist } from '../components/client-setup-checklist';
import {
  buildClientSetupChecklist,
  formatEt,
  readStoreSetupFacts,
  safeSetupNext,
  safeSetupReturn,
  sharedFlagLabels,
  type ClientSetupChecklistInput,
} from '../lib/client-setup-checklist';
import { bundledMissingFactLabels } from '../lib/skill-missing-facts';
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
  loadProfileCta,
  SKILL_PROFILE_ALIASES,
} from '../lib/ui-copy';

const here = dirname(fileURLToPath(import.meta.url));
const STORE = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const SECRET_ID = 'act_secret_999';
const PROPERTY = 'sc-domain:hvacusa.com';

assert.equal(META_NEEDS_RECONNECT, META_RECONNECT_MESSAGE);
assert.equal(META_PERMISSION, META_PERMISSION_MESSAGE);
assert.equal(META_RATE_LIMIT, META_RATE_LIMIT_MESSAGE);
assert.deepEqual(SKILL_PROFILE_ALIASES, SKILL_CLIENT_ALIASES);
assert.equal(loadProfileCta('HVAC USA'), 'Load the HVAC USA profile');
assert.equal(formatEt('2026-01-15T15:04:00.000Z'), 'Jan 15, 2026, 10:04 AM ET');
assert.equal(formatEt('not-a-date'), null);
assert.equal(safeSetupReturn(`/stores/${STORE}/setup`), `/stores/${STORE}/setup`);
assert.equal(safeSetupReturn('https://evil.example/stores'), null);
assert.equal(safeSetupNext(STORE, '/onboarding'), '/onboarding');
assert.equal(safeSetupNext(STORE, `/api/ads/connect?platform=meta&clientId=${CLIENT}`), `/api/ads/connect?platform=meta&clientId=${CLIENT}`);
assert.equal(safeSetupNext(STORE, 'https://evil.example'), null);
assert.equal(safeSetupNext(STORE, '/onboarding?next=https://evil.example'), null);
assert.equal(safeSetupNext('not-a-store', '/onboarding'), null);

function ready(over: Partial<ClientSetupChecklistInput> = {}): ClientSetupChecklistInput {
  return {
    storeId: STORE,
    storeName: 'HVAC USA',
    platform: 'shopify',
    shopifyConnected: true,
    wordpressAnswering: false,
    address: 'hvac.myshopify.com',
    websiteConnectedAt: null,
    websiteCheckedAt: null,
    businessType: 'ecommerce',
    businessTypeLabel: 'Online store',
    ads: { status: 'linked', clientId: CLIENT, name: 'HVAC USA' },
    metaAccounts: [{ externalId: 'act_live', displayName: 'Meta HVAC', status: 'connected' }],
    googleAccounts: [{ externalId: '123-456-7890', displayName: 'Google HVAC', status: 'connected' }],
    googleConfigured: true,
    searchConsole: { propertyUrl: PROPERTY, connectedAt: '2026-01-15T15:04:00.000Z', linked: true },
    ga4: { available: false },
    callrailPresent: false,
    skills: { status: 'linked', profileName: 'HVAC USA', missingFacts: 0, missingFactLabels: [] },
    owner: true,
    flagsOn: ['Ads cockpit', 'Audits', 'Live platform sync'],
    ...over,
  };
}

function decode(markup: string): string {
  return markup.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function render(over: Partial<ClientSetupChecklistInput> = {}) {
  const model = buildClientSetupChecklist(ready(over));
  const html = decode(renderToStaticMarkup(createElement(ClientSetupChecklist, {
    model,
    continueAction: async () => {},
    skillsAction: async () => {},
  })));
  return { model, html };
}

function row(markup: string, id: string): string {
  const token = `data-setup-row="${id}"`;
  const start = markup.indexOf(token);
  assert.ok(start >= 0, id);
  const nextRow = markup.indexOf('data-setup-row=', start + token.length);
  const flags = markup.indexOf('data-setup-flags');
  const ends = [nextRow, flags].filter((index) => index > start);
  const end = ends.length ? Math.min(...ends) : markup.length;
  return markup.slice(start, end);
}

function outside(markup: string): string {
  return markup.replace(/<details[\s\S]*?<\/details>/gi, '');
}

function ctaCount(markup: string): number {
  return markup.match(/class="btn-cta"/g)?.length ?? 0;
}

const done = render();
assert.equal(done.model.progressLabel, '7 of 8 done');
assert.equal(done.model.requiredComplete, true);
assert.equal(done.model.rows.some((item) => item.id === 'callrail'), false);
assert.equal(ctaCount(done.html), 0);
assert.match(row(done.html, 'ga4'), new RegExp(GA4_LATER));
assert.equal(done.html.includes('CallRail'), false);
assert.match(row(done.html, 'website'), new RegExp(SHOPIFY_CONNECTED));
assert.match(row(done.html, 'business_type'), /Online store/);
assert.match(row(done.html, 'ads_client'), new RegExp(ADS_CLIENT_LINKED));
assert.match(row(done.html, 'meta'), new RegExp(META_CONNECTED));
assert.match(row(done.html, 'google'), new RegExp(GOOGLE_CONNECTED));
assert.match(row(done.html, 'search_console'), new RegExp(SEARCH_CONSOLE_DONE));
assert.match(row(done.html, 'skills'), new RegExp(SKILLS_LINKED));
assert.equal(outside(done.html).includes('act_live'), false);
assert.equal(outside(done.html).includes('123-456-7890'), false);
assert.equal(outside(done.html).includes(PROPERTY), false);
assert.match(done.html, new RegExp(PROPERTY));
assert.match(done.html, /Jan 15, 2026, 10:04 AM ET/);
assert.equal(done.html.includes('needs_reconnect'), false);
assert.match(done.html, /These are on for every client: Ads cockpit, Audits, Live platform sync/);
assert.equal(done.html.match(/for every client/g)?.length, 1);

const shopifyOff = render({ shopifyConnected: false, businessType: null, businessTypeLabel: null });
assert.match(row(shopifyOff.html, 'website'), new RegExp(SHOPIFY_NOT_CONNECTED));
assert.match(row(shopifyOff.html, 'website'), new RegExp(ADD_SHOPIFY));
assert.equal(ctaCount(shopifyOff.html), 1);
assert.match(row(shopifyOff.html, 'website'), /class="btn-cta"/);
assert.match(row(shopifyOff.html, 'business_type'), /class="btn-secondary"/);
assert.doesNotMatch(row(shopifyOff.html, 'business_type'), /class="btn-cta"/);

const businessGap = render({ businessType: null, businessTypeLabel: null });
assert.match(row(businessGap.html, 'business_type'), new RegExp(PICK_BUSINESS_TYPE.replace('.', '\\.')));
assert.equal(businessGap.model.primaryRowId, 'business_type');
assert.equal(ctaCount(businessGap.html), 1);

const unlinked = render({ ads: { status: 'missing' }, metaAccounts: [], googleAccounts: [], skills: { status: 'missing', profileName: 'HVAC USA' } });
assert.match(row(unlinked.html, 'ads_client'), new RegExp(ADS_CLIENT_MISSING));
assert.match(row(unlinked.html, 'ads_client'), new RegExp(NAME_THIS_CLIENT));
assert.equal(unlinked.model.primaryRowId, 'ads_client');

const mismatch = render({ ads: { status: 'linked', clientId: CLIENT, name: 'KC Prestige HVAC' } });
assert.match(row(mismatch.html, 'ads_client'), /The ads client is named KC Prestige HVAC/);
assert.match(row(mismatch.html, 'ads_client'), new RegExp(FIX_CLIENT_NAME));

const duplicate = render({
  ads: { status: 'duplicate' },
  metaAccounts: null,
  googleAccounts: null,
  skills: null,
  callrailPresent: null,
});
assert.match(row(duplicate.html, 'ads_client'), new RegExp(ADS_CLIENT_DUPLICATE));
assert.equal(duplicate.model.adsNotice, null);

const unknown = render({
  ads: { status: 'unknown' },
  metaAccounts: null,
  googleAccounts: null,
  skills: null,
});
assert.match(row(unknown.html, 'meta'), new RegExp(COULD_NOT_LOAD));
assert.match(unknown.html, new RegExp(COULD_NOT_LOAD_ADS));
assert.equal(unknown.model.primaryRowId, null);
assert.equal(ctaCount(unknown.html), 0);

const metaSentences: Array<[string, string, string | null]> = [
  ['disconnected', META_DISCONNECTED, CONNECT_META],
  ['syncing', META_SYNCING, null],
  ['needs_reconnect', META_NEEDS_RECONNECT, RECONNECT_META],
  ['expiring', META_EXPIRING, RECONNECT_META],
  ['limited', META_PERMISSION, RECONNECT_META],
  ['error', META_NO_ANSWER, RECONNECT_META],
  ['rate_limited', META_RATE_LIMIT, null],
  ['not_configured', META_NOT_ON_SERVER, null],
  ['pending', META_PENDING, CONNECT_META],
];
for (const [status, sentence, label] of metaSentences) {
  const view = render({
    metaAccounts: [{ externalId: SECRET_ID, displayName: 'Meta HVAC', status }],
  });
  const meta = row(view.html, 'meta');
  assert.match(meta, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), status);
  if (label) assert.match(meta, new RegExp(label));
  assert.equal(outside(view.html).includes(SECRET_ID), false, status);
  assert.match(view.html, new RegExp(SECRET_ID));
  if (status.includes('_')) assert.equal(view.html.includes(status), false, status);
}

const reconnectMix = render({
  metaAccounts: [
    { externalId: 'act_live', displayName: 'Meta HVAC', status: 'connected' },
    { externalId: SECRET_ID, displayName: 'Old Meta', status: 'needs_reconnect' },
  ],
});
assert.match(row(reconnectMix.html, 'meta'), new RegExp(META_CONNECTED));
assert.equal(reconnectMix.model.rows.find((item) => item.id === 'meta')?.done, true);
assert.match(reconnectMix.html, new RegExp(META_NEEDS_RECONNECT));
assert.match(reconnectMix.html, /data-setup-reconnect/);
assert.match(row(reconnectMix.html, 'meta'), new RegExp(RECONNECT_META));
assert.equal(outside(reconnectMix.html).includes(SECRET_ID), false);
assert.equal(ctaCount(reconnectMix.html), 0);

const googleSentences: Array<[string, string, string | null]> = [
  ['disconnected', GOOGLE_DISCONNECTED, CONNECT_GOOGLE],
  ['syncing', GOOGLE_SYNCING, null],
  ['needs_reconnect', GOOGLE_NEEDS_RECONNECT, RECONNECT_GOOGLE],
  ['expiring', GOOGLE_EXPIRING, RECONNECT_GOOGLE],
  ['limited', GOOGLE_PERMISSION, RECONNECT_GOOGLE],
  ['error', GOOGLE_NO_ANSWER, RECONNECT_GOOGLE],
  ['rate_limited', GOOGLE_RATE_LIMIT, null],
  ['pending', GOOGLE_PENDING, CONNECT_GOOGLE],
];
for (const [status, sentence, label] of googleSentences) {
  const view = render({
    googleConfigured: true,
    googleAccounts: [{ externalId: '999-000-1111', displayName: 'Google HVAC', status }],
  });
  const google = row(view.html, 'google');
  assert.match(google, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), status);
  if (label) assert.match(google, new RegExp(label));
  assert.equal(view.model.primaryRowId, null);
}

const googleOff = render({ googleConfigured: false, googleAccounts: [] });
assert.match(row(googleOff.html, 'google'), new RegExp(GOOGLE_NOT_ON_SERVER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.equal(row(googleOff.html, 'google').includes(CONNECT_GOOGLE), false);
assert.equal(googleOff.model.primaryRowId, null);

const gscMissing = render({ searchConsole: { propertyUrl: null, connectedAt: null, linked: false } });
assert.match(row(gscMissing.html, 'search_console'), new RegExp(SEARCH_CONSOLE_MISSING));
assert.match(row(gscMissing.html, 'search_console'), new RegExp(CONNECT_SEARCH_CONSOLE));
assert.match(gscMissing.html, new RegExp(`/api/gsc/oauth/start\\?storeId=${STORE}`));

const gscPick = render({ searchConsole: { propertyUrl: null, connectedAt: null, linked: true } });
assert.match(row(gscPick.html, 'search_console'), new RegExp(SEARCH_CONSOLE_PICK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(gscPick.html, /value="\/settings#connects"/);

const ga4Connect = render({ ga4: { available: true, propertyId: null } });
assert.match(row(ga4Connect.html, 'ga4'), new RegExp(GA4_MISSING));
assert.match(row(ga4Connect.html, 'ga4'), new RegExp(CONNECT_GA4));
assert.equal(ga4Connect.model.primaryRowId, null);

const ga4Done = render({ ga4: { available: true, propertyId: 'properties/123' } });
assert.match(row(ga4Done.html, 'ga4'), new RegExp(GA4_DONE));
assert.equal(outside(ga4Done.html).includes('properties/123'), false);
assert.match(ga4Done.html, /properties\/123/);

const home = render({ businessType: 'home_service', businessTypeLabel: 'Home-service business', callrailPresent: false });
assert.equal(home.model.total, 9);
assert.match(row(home.html, 'callrail'), new RegExp(CALLRAIL_MISSING));
assert.match(row(home.html, 'callrail'), new RegExp(CONNECT_CALLRAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.equal(ctaCount(home.html), 0);
assert.match(row(home.html, 'callrail'), /class="btn-secondary"/);

const callrailOn = render({ businessType: 'home_service', businessTypeLabel: 'Home-service business', callrailPresent: true });
assert.match(row(callrailOn.html, 'callrail'), new RegExp(CALLRAIL_DONE));
assert.equal(callrailOn.model.progressLabel, '8 of 9 done');

const facts = ['Service area', 'License number'];
const missingFacts = render({
  skills: { status: 'linked', profileName: 'HVAC USA', missingFacts: 14, missingFactLabels: facts },
});
assert.match(row(missingFacts.html, 'skills'), /14 facts still missing/);
assert.equal(outside(missingFacts.html).includes('Service area'), false);
assert.match(missingFacts.html, /Service area/);
assert.match(missingFacts.html, /License number/);
const oneFact = render({
  skills: { status: 'linked', profileName: 'HVAC USA', missingFacts: 1, missingFactLabels: ['Phone'] },
});
assert.match(row(oneFact.html, 'skills'), /1 fact still missing/);

const loadSkills = render({
  skills: { status: 'missing', profileName: 'HVAC USA' },
});
assert.match(row(loadSkills.html, 'skills'), /Load the HVAC USA profile/);
assert.match(row(loadSkills.html, 'skills'), /value="hvac-usa"/);
assert.equal(loadSkills.model.primaryRowId, 'skills');
assert.equal(ctaCount(loadSkills.html), 1);

const loadedOnly = render({ skills: { status: 'loaded', profileName: 'HVAC USA' } });
assert.match(row(loadedOnly.html, 'skills'), new RegExp(SKILLS_LOADED_NOT_LINKED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.equal(loadedOnly.model.rows.find((item) => item.id === 'skills')?.done, false);

const visitor = render({ owner: false, skills: { status: 'missing', profileName: 'HVAC USA' } });
assert.match(row(visitor.html, 'skills'), new RegExp(SKILLS_OWNER_ONLY));
assert.equal(row(visitor.html, 'skills').includes('btn-cta'), false);
assert.equal(ctaCount(visitor.html), 0);

const flags = render({
  flagsOn: ['Ads cockpit', 'Audits', 'Live platform sync', 'WordPress connect'],
});
assert.match(flags.html, /These are on for every client: Ads cockpit, Audits, Live platform sync…/);
assert.match(flags.html, /WordPress connect/);
assert.equal(flags.html.match(/for every client/g)?.length, 1);
const defaults = sharedFlagLabels(defaultCapabilityFlags());
assert.ok(defaults?.includes('Ads cockpit'));
assert.ok(defaults?.includes('Live platform sync'));
assert.equal(defaults?.includes('In market'), false);
assert.equal(defaults?.includes('Legacy ads-web chrome'), false);

const shopifyFacts = readStoreSetupFacts({
  name: 'HVAC USA',
  shopify_domain: 'hvac.myshopify.com',
  platform: 'shopify',
  config: { workspace: {} },
  shopifyTokenPresent: false,
});
assert.equal(shopifyFacts.shopifyConnected, false);
assert.equal(shopifyFacts.businessType, null);
assert.equal(shopifyFacts.ga4.available, false);
const shopifyView = render({ ...shopifyFacts, storeName: 'HVAC USA' });
assert.match(row(shopifyView.html, 'website'), new RegExp(SHOPIFY_NOT_CONNECTED));
assert.match(row(shopifyView.html, 'business_type'), new RegExp(PICK_BUSINESS_TYPE.replace('.', '\\.')));
assert.match(row(shopifyView.html, 'ga4'), new RegExp(GA4_LATER));

const verified = readStoreSetupFacts({
  shopify_domain: 'hvac.myshopify.com',
  platform: 'shopify',
  config: { shopify: { status: 'not_connected' }, workspace: { businessType: 'agency' } },
  shopifyTokenPresent: true,
});
assert.equal(verified.shopifyConnected, false);
assert.equal(verified.businessType, null);

const wordpressOff = readStoreSetupFacts({
  shopify_domain: 'https://kc.example.com/path?pluginKey=secret',
  platform: 'wordpress',
  connector_type: 'wordpress',
  config: {
    wordpress: { pluginKeyEnc: 'plugin-secret', lastHealthOk: false, siteUrl: 'https://kc.example.com/?key=secret' },
    gsc: { refreshTokenEnc: 'gsc-secret' },
  },
  shopifyTokenPresent: true,
});
assert.equal(wordpressOff.wordpressAnswering, false);
assert.equal(wordpressOff.address, 'kc.example.com');
assert.equal(JSON.stringify(wordpressOff).includes('secret'), false);
const wordpressView = render({ ...wordpressOff });
assert.match(row(wordpressView.html, 'website'), new RegExp(WORDPRESS_NOT_ANSWERING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(row(wordpressView.html, 'website'), new RegExp(CHECK_PLUGIN));
assert.equal(wordpressView.html.includes('plugin-secret'), false);
assert.equal(wordpressView.html.includes('gsc-secret'), false);

const wordpressOn = readStoreSetupFacts({
  platform: 'wordpress',
  connector_type: 'wordpress',
  shopify_domain: 'kc.example.com',
  config: { wordpress: { pluginKeyEnc: 'enc', lastHealthOk: true, connectedAt: '2026-01-15T15:04:00.000Z' }, workspace: { businessType: 'home_service' } },
  shopifyTokenPresent: true,
});
assert.equal(wordpressOn.wordpressAnswering, true);
assert.equal(wordpressOn.businessType, 'home_service');
const wordpressDone = render({ ...wordpressOn, callrailPresent: true });
assert.match(row(wordpressDone.html, 'website'), new RegExp(WORDPRESS_ANSWERING));

const hvacFacts = bundledMissingFactLabels('hvac-usa');
assert.ok(hvacFacts.length > 0);
assert.equal(hvacFacts.some((label) => label.includes('**')), false);

const page = readFileSync(join(here, '../app/stores/[id]/setup/page.tsx'), 'utf8');
const data = readFileSync(join(here, '../lib/client-setup-data.ts'), 'utf8');
const stores = readFileSync(join(here, '../app/stores/page.tsx'), 'utf8');
const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
assert.equal(page.includes('shopify_access_token'), false);
assert.equal(page.includes('ensureSiteClient'), false);
assert.match(page, /Switch to this store/);
assert.match(page, /btn-secondary/);
assert.equal(data.includes('PUT'), false);
assert.equal(data.includes('POST'), false);
assert.match(stores, /Setup · /);
assert.match(css, /\.cx-setup \{[^}]*max-width: 100%/);
assert.match(css, /\.cx-setup-row \{[^}]*overflow-wrap: anywhere/);
assert.match(css, /\.cx-setup-row \{[^}]*max-width: 100%/);

console.log('client-setup-checklist: ok');
