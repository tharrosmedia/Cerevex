import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkspaceModuleSettings } from '@cerevex/contracts';
import {
  CLIENT_BUSINESS_TYPE_LABELS,
  CLIENT_BUSINESS_TYPES,
  adsPatchForClientBusinessType,
  commitClientBusinessType,
  emptyClientWorkspaceConfig,
  resolveWorkspaceModuleSettings,
} from '../src/lib/db/client-workspace';
import { newWordpressStoreConfig } from '../src/lib/wordpress/connect-config';

const root = dirname(fileURLToPath(import.meta.url));

const completedAt = '2026-10-06T14:00:00.000Z';
const cookieA = {
  businessType: 'ecommerce',
  modules: { leads: true, clients: false, sales: true, workflows: true },
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
  capabilities: { 'site.wordpress.connect': 'on' },
};

const storeA = {
  id: 'store-a',
  config: {
    workspace: {
      businessType: 'ecommerce',
      modules: { leads: true, clients: false, sales: true, workflows: true },
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
    },
  },
};

const storeB = {
  id: 'store-b',
  config: emptyClientWorkspaceConfig(),
};

const selectedB = resolveWorkspaceModuleSettings({ store: storeB, cookie: cookieA });
assert.equal(selectedB.businessType, null);
assert.equal(selectedB.onboardingComplete, false, 'Ads redirects to onboarding when this client has no business type');

const selectedA = resolveWorkspaceModuleSettings({ store: storeA, cookie: { businessType: 'home_service' } });
assert.equal(selectedA.businessType, 'ecommerce');
assert.equal(selectedA.onboardingComplete, true);

const adsPage = readFileSync(join(root, '../app/ads/page.tsx'), 'utf8');
assert.match(adsPage, /if \(!settings\.onboardingComplete\) \{\s*redirect\('\/onboarding'\)/);

const patches: Array<{ businessType?: string }> = [];
const persisted = { b: null as Record<string, unknown> | null };
const savedB = await commitClientBusinessType('home_service', {
  store: storeB,
  cookie: cookieA,
  completedAt,
  persist: async (next) => {
    persisted.b = next;
  },
  patchAds: async (body) => {
    patches.push(body);
  },
});

assert.equal(patches.length, 0);
assert.equal(patches.some((body) => body.businessType != null), false);
assert.equal(adsPatchForClientBusinessType(), null);
assert.equal(savedB.businessType, 'home_service');
assert.equal(savedB.onboardingComplete, true);
assert.equal(savedB.modules.sales, false);
assert.equal(savedB.modules.clients, false);
assert.equal(persisted.b?.businessType, 'home_service');
assert.equal(persisted.b?.onboardingCompletedAt, completedAt);
assert.equal(
  Object.prototype.hasOwnProperty.call(persisted.b, 'capabilities'),
  false,
  'store B does not inherit store A cookie capabilities',
);
assert.equal(parseWorkspaceModuleSettings(storeA.config.workspace).businessType, 'ecommerce');

const stores = new Map<string, { config: { workspace?: Record<string, unknown> } }>([
  ['a', { config: { workspace: { ...storeA.config.workspace } } }],
  ['b', { config: emptyClientWorkspaceConfig() }],
]);
await commitClientBusinessType('home_service', {
  store: stores.get('b')!,
  cookie: cookieA,
  completedAt,
  persist: async (next) => {
    stores.get('b')!.config.workspace = next;
  },
  patchAds: async (body) => {
    patches.push(body);
  },
});
assert.equal(parseWorkspaceModuleSettings(stores.get('a')!.config.workspace).businessType, 'ecommerce');
assert.equal(parseWorkspaceModuleSettings(stores.get('b')!.config.workspace).businessType, 'home_service');
assert.equal(patches.length, 0);

const fromCookie = resolveWorkspaceModuleSettings({ store: null, cookie: cookieA });
assert.equal(fromCookie.businessType, 'ecommerce');
assert.equal(fromCookie.onboardingComplete, true);
const noCookie = resolveWorkspaceModuleSettings({ store: null, cookie: null });
assert.equal(noCookie.businessType, null);
assert.equal(noCookie.onboardingComplete, false);

const cookieSaved = { current: null as Record<string, unknown> | null };
const cookiePatches: Array<{ businessType?: string }> = [];
await commitClientBusinessType('ecommerce', {
  store: null,
  cookie: null,
  completedAt,
  persist: async (next) => {
    cookieSaved.current = next;
  },
  patchAds: async (body) => {
    cookiePatches.push(body);
  },
});
assert.equal(cookieSaved.current?.businessType, 'ecommerce');
assert.equal(cookiePatches.length, 0);
assert.equal(resolveWorkspaceModuleSettings({ store: null, cookie: cookieSaved.current }).businessType, 'ecommerce');

const agencyPatches: unknown[] = [];
let agencyPersisted = false;
await assert.rejects(
  () => commitClientBusinessType('agency', {
    store: storeB,
    cookie: cookieA,
    persist: async () => {
      agencyPersisted = true;
    },
    patchAds: async (body) => {
      agencyPatches.push(body);
    },
  }),
  /Home-service business or Online store/,
);
assert.equal(agencyPersisted, false);
assert.equal(agencyPatches.length, 0);

const keptRecord = { current: null as Record<string, unknown> | null };
const kept = await commitClientBusinessType('home_service', {
  store: {
    config: {
      workspace: {
        capabilities: { 'site.wordpress.connect': 'on' },
      },
    },
  },
  cookie: { ...cookieA, fromCookie: true },
  completedAt,
  persist: async (next) => {
    keptRecord.current = next;
  },
  patchAds: async () => {
    throw new Error('PATCH must not leave Brain');
  },
});
assert.equal(kept.businessType, 'home_service');
assert.equal(kept.modules.sales, false);
assert.equal(keptRecord.current?.fromCookie, undefined);
assert.equal(
  (keptRecord.current?.capabilities as Record<string, unknown> | undefined)?.['site.wordpress.connect'],
  'on',
);

const wp = newWordpressStoreConfig({
  wordpress: { siteUrl: 'https://kc.example', pluginKeyEnc: 'enc' },
});
assert.equal(wp.wordpress.applyKillSwitch, true);
assert.equal(Object.prototype.hasOwnProperty.call(wp, 'workspace'), false);

const wpOff = newWordpressStoreConfig({
  wordpress: { siteUrl: 'https://kc.example', applyKillSwitch: false },
});
assert.equal(wpOff.wordpress.applyKillSwitch, false);
assert.equal(Object.prototype.hasOwnProperty.call(wpOff, 'workspace'), false);

const shopifyConfig = emptyClientWorkspaceConfig();
assert.deepEqual(shopifyConfig, { workspace: {} });
assert.equal(parseWorkspaceModuleSettings(shopifyConfig.workspace).businessType, null);

const modulesSrc = readFileSync(join(root, '../src/lib/db/workspace-modules.ts'), 'utf8');
const saveFn = modulesSrc.slice(
  modulesSrc.indexOf('export async function saveBusinessType'),
  modulesSrc.indexOf('export async function saveModuleOverrides'),
);
assert.equal(saveFn.includes('patchAdsWorkspaceSettings({ businessType'), false);
assert.match(saveFn, /Do not PATCH businessType/);
assert.match(modulesSrc, /const cookie = store \? null : await readCookieSettings\(\)/);

const onboarding = readFileSync(join(root, '../app/onboarding/page.tsx'), 'utf8');
assert.match(onboarding, /CLIENT_BUSINESS_TYPES/);
assert.match(onboarding, /isClientBusinessType/);
assert.equal(onboarding.includes('agency'), false);
assert.match(onboarding, /CLIENT_BUSINESS_TYPE_LABELS/);

const storesPage = readFileSync(join(root, '../app/stores/page.tsx'), 'utf8');
assert.match(storesPage, /config: emptyClientWorkspaceConfig\(\)/);

const connectSrc = readFileSync(join(root, '../src/lib/wordpress/connect.ts'), 'utf8');
assert.match(connectSrc, /newWordpressStoreConfig\(\{ wordpress \}\)/);
assert.match(connectSrc, /wordpressConnectBlockedFromSource\(\{ workspaceSettings, store \}\)/);

assert.deepEqual(CLIENT_BUSINESS_TYPES, ['home_service', 'ecommerce']);
assert.equal(CLIENT_BUSINESS_TYPE_LABELS.home_service, 'Home-service business');
assert.equal(CLIENT_BUSINESS_TYPE_LABELS.ecommerce, 'Online store');
assert.equal(Object.prototype.hasOwnProperty.call(CLIENT_BUSINESS_TYPE_LABELS, 'agency'), false);

console.log('client-business-type: ok');
