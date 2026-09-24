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
import { wordpressApplyBlockedByKillSwitch } from '../src/lib/wordpress/store';
import { wordpressFlagsFromStore } from '../src/lib/wordpress/capabilities';

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

assert.equal(
  wordpressApplyBlockedByKillSwitch({ config: { wordpress: { applyKillSwitch: true } } }),
  true,
);
assert.equal(
  wordpressApplyBlockedByKillSwitch({ config: { workspace: { wordpressApplyKillSwitch: true } } }),
  true,
);
assert.equal(wordpressApplyBlockedByKillSwitch({ config: { wordpress: { applyKillSwitch: false } } }), false);

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
