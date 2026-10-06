import assert from 'node:assert/strict';
import {
  ISOLATION,
  SEO_EVENTS,
  SEO_FUNCTION_IDS,
  siteCmsPlainError,
  wordpressApplyBlockedReason,
  wordpressConnectBlockedReason,
  wordpressSyncBlockedReason,
} from '@cerevex/contracts';
import { shopifySiteConnector } from '@cerevex/connector-shopify';
import { createWordPressConnector, validateApprovedApplyPayload } from '@cerevex/connector-wordpress';
import {
  newWordpressStoreConfig,
  wordpressConnectBlockedFromSource,
} from '../src/lib/wordpress/connect-config';
import { wordpressApplyBlockedByKillSwitch } from '../src/lib/wordpress/store';
import { wordpressApplyGateReason, wordpressFlagsFromStore } from '../src/lib/wordpress/capabilities';
import { clearAdsApplyGateCache } from '../src/lib/ads-apply-gate';

assert.equal(ISOLATION.brainInngestApp, 'Cerevex');
assert.equal(ISOLATION.osInngestApp, 'cerevex-ads');
assert.equal(SEO_EVENTS.wordpressSync, 'seo/wordpress.sync');
assert.equal(SEO_EVENTS.wordpressApply, 'seo/wordpress.apply');
assert.equal(SEO_FUNCTION_IDS.wordpressSync, 'seo-wordpress-sync');
assert.equal(SEO_FUNCTION_IDS.wordpressApply, 'seo-wordpress-apply');

const hiddenStore = { config: { workspace: { capabilities: {} } } };
const flags = wordpressFlagsFromStore(hiddenStore);
assert.equal(wordpressConnectBlockedReason(flags), 'capability_site_wordpress_connect');
assert.equal(wordpressSyncBlockedReason(flags), 'capability_site_wordpress_sync');
assert.equal(wordpressApplyBlockedReason(flags), 'capability_site_wordpress_apply');

const recommendOnly = wordpressFlagsFromStore({
  config: { workspace: { capabilities: { 'site.wordpress.apply': 'recommend_only' } } },
});
assert.equal(wordpressApplyBlockedReason(recommendOnly), 'capability_site_wordpress_apply_recommend_only');

const unconfirmedApply = wordpressFlagsFromStore({
  config: {
    workspace: {
      capabilities: { 'site.wordpress.apply': 'on', 'site.wordpress.connect': 'on', 'site.wordpress.sync': 'on' },
    },
  },
});
assert.equal(unconfirmedApply['site.wordpress.apply'], 'hidden');
assert.equal(unconfirmedApply['site.wordpress.connect'], 'on');
assert.equal(unconfirmedApply['site.wordpress.sync'], 'on');
assert.equal(wordpressApplyBlockedReason(unconfirmedApply), 'capability_site_wordpress_apply');

const confirmedApply = wordpressFlagsFromStore({
  config: {
    workspace: {
      capabilities: { 'site.wordpress.apply': 'on' },
      adsConfirmedSafety: ['site.wordpress.apply'],
    },
  },
});
assert.equal(confirmedApply['site.wordpress.apply'], 'hidden');
assert.equal(wordpressApplyBlockedReason(confirmedApply), 'capability_site_wordpress_apply');

const adsWorkspaceId = '11111111-1111-4111-8111-111111111111';
const previousAdsUrl = process.env.ADS_API_URL;
const previousAdsWorkspace = process.env.ADS_INTERNAL_WORKSPACE_ID;
const previousAdsKey = process.env.ADS_INTERNAL_KEY;
const previousFetch = globalThis.fetch;
process.env.ADS_API_URL = 'http://ads.test';
process.env.ADS_INTERNAL_WORKSPACE_ID = adsWorkspaceId;
process.env.ADS_INTERNAL_KEY = 'test-internal';
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      workspace: { id: adsWorkspaceId, capabilities: { 'site.wordpress.apply': 'on' } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
clearAdsApplyGateCache();
try {
  assert.equal(await wordpressApplyGateReason({ config: { workspace: {} } }), null);
  clearAdsApplyGateCache();
  assert.equal(
    await wordpressApplyGateReason({
      config: { workspace: { capabilities: { 'site.wordpress.apply': 'hidden' } } },
    }),
    'capability_site_wordpress_apply',
  );
  clearAdsApplyGateCache();
  assert.equal(
    await wordpressApplyGateReason({
      config: { workspace: { capabilities: { 'site.wordpress.apply': 'recommend_only' } } },
    }),
    'capability_site_wordpress_apply_recommend_only',
  );
} finally {
  clearAdsApplyGateCache();
  globalThis.fetch = previousFetch;
  if (previousAdsUrl === undefined) delete process.env.ADS_API_URL;
  else process.env.ADS_API_URL = previousAdsUrl;
  if (previousAdsWorkspace === undefined) delete process.env.ADS_INTERNAL_WORKSPACE_ID;
  else process.env.ADS_INTERNAL_WORKSPACE_ID = previousAdsWorkspace;
  if (previousAdsKey === undefined) delete process.env.ADS_INTERNAL_KEY;
  else process.env.ADS_INTERNAL_KEY = previousAdsKey;
}

assert.equal(wordpressApplyBlockedByKillSwitch({}), true);
assert.equal(wordpressApplyBlockedByKillSwitch({ config: {} }), true);
assert.equal(wordpressApplyBlockedByKillSwitch({ config: { wordpress: {} } }), true);
assert.equal(
  wordpressApplyBlockedByKillSwitch({ config: { wordpress: { applyKillSwitch: true } } }),
  true,
);
assert.equal(
  wordpressApplyBlockedByKillSwitch({ config: { workspace: { wordpressApplyKillSwitch: true } } }),
  true,
);
assert.equal(wordpressApplyBlockedByKillSwitch({ config: { wordpress: { applyKillSwitch: false } } }), false);
assert.equal(
  wordpressApplyBlockedByKillSwitch({
    config: { wordpress: { applyKillSwitch: false }, workspace: { wordpressApplyKillSwitch: true } },
  }),
  true,
);

const sourceWorkspace = {
  capabilities: {
    'site.wordpress.connect': 'on',
    'site.wordpress.sync': 'on',
    'site.wordpress.apply': 'on',
  },
};
assert.equal(wordpressConnectBlockedFromSource({ store: null }), 'capability_site_wordpress_connect');
assert.equal(wordpressConnectBlockedFromSource({ workspaceSettings: {} }), 'capability_site_wordpress_connect');
assert.equal(wordpressConnectBlockedFromSource({ workspaceSettings: sourceWorkspace }), null);
assert.equal(
  wordpressConnectBlockedFromSource({
    store: { config: { workspace: sourceWorkspace } },
  }),
  null,
);

const seeded = newWordpressStoreConfig({
  wordpress: { siteUrl: 'https://hvac-pilot.example', pluginKeyEnc: 'enc' },
});
assert.equal(seeded.wordpress.applyKillSwitch, true);
assert.equal(Object.prototype.hasOwnProperty.call(seeded, 'workspace'), false);

const unsigned = validateApprovedApplyPayload({
  approved: false,
  approvalId: 'x',
  approvedAt: 't',
  storeId: 's',
  externalId: '1',
  resourceType: 'post',
  title: 'Hi',
});
assert.equal(unsigned.ok, false);
assert.equal(unsigned.writes, false);

const down = createWordPressConnector({
  siteUrl: 'https://pilot.example',
  pluginKey: 'key',
  fetchImpl: async () => {
    throw new Error('offline');
  },
});
const health = await down.health();
assert.equal(health.ok, false);
assert.equal(health.code, 'unreachable');
assert.equal(health.reason, siteCmsPlainError('unreachable'));
const listed = await down.listContent();
assert.equal(listed.ok, false);
assert.deepEqual(listed.items, []);

const badAuth = createWordPressConnector({
  siteUrl: 'https://pilot.example',
  pluginKey: 'wrong',
  fetchImpl: async () => new Response('no', { status: 401 }),
});
assert.equal((await badAuth.health()).code, 'bad_auth');

const missing = createWordPressConnector({
  siteUrl: 'https://pilot.example',
  pluginKey: 'key',
  fetchImpl: async () => new Response('missing', { status: 404 }),
});
assert.equal((await missing.health()).code, 'plugin_not_found');

const shopify = await shopifySiteConnector.apply({
  approved: true,
  approvalId: 'a',
  approvedAt: 't',
  storeId: 's',
  externalId: '1',
  resourceType: 'page',
  title: 'x',
});
assert.equal(shopify.writes, false);

console.log('wordpress-degrade: ok');
