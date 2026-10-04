import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IN_MARKET_CONNECT_GOOGLE,
  IN_MARKET_CONNECT_META,
  IN_MARKET_EMPTY_GOOGLE,
  IN_MARKET_EMPTY_META,
  IN_MARKET_HELPER,
  IN_MARKET_LOAD_ERROR,
  IN_MARKET_OPEN_GOOGLE,
  IN_MARKET_OPEN_META,
  buildInMarketView,
  cockpitCostPerResultUsd,
  defaultCapabilityFlags,
  defaultModulesFor,
  inMarketChip,
  inMarketDeepLink,
  resolveAdsNav,
  type InMarketSourceAccount,
  type InMarketSourceEntity,
} from '@cerevex/contracts';

const now = new Date('2026-09-28T12:00:00.000Z');
const recent = '2026-09-26T12:00:00.000Z';
const old = '2026-08-01T12:00:00.000Z';

function account(partial: Partial<InMarketSourceAccount> & Pick<InMarketSourceAccount, 'id' | 'platform'>): InMarketSourceAccount {
  return {
    externalId: partial.platform === 'meta' ? 'act_100' : '200',
    displayName: partial.platform === 'meta' ? 'Meta main' : 'Google main',
    connectionStatus: 'connected',
    lastSyncAt: recent,
    hasCredentials: true,
    ...partial,
  };
}

function entity(partial: Partial<InMarketSourceEntity> & Pick<InMarketSourceEntity, 'id' | 'entityType' | 'externalId'>): InMarketSourceEntity {
  return {
    adAccountId: 'meta-1',
    platform: 'meta',
    name: partial.externalId,
    status: 'active',
    parentExternalId: null,
    syncedAt: recent,
    raw: {},
    ...partial,
  };
}

assert.equal(defaultCapabilityFlags().in_market, 'hidden');
assert.equal(cockpitCostPerResultUsd('100', '4'), 25);
assert.equal(cockpitCostPerResultUsd('40', '0'), Number.POSITIVE_INFINITY);
assert.equal(cockpitCostPerResultUsd('0', '0'), null);

const hiddenNav = resolveAdsNav({ shell: 'inShell', modules: defaultModulesFor('home_service') });
assert.equal(hiddenNav.some((item) => item.label === 'In market'), false);
assert.deepEqual(
  hiddenNav.filter((item) => item.rail).map((item) => item.rail),
  ['Audits', 'Suggestions', 'Audit log'],
);

const liveNav = resolveAdsNav({
  shell: 'inShell',
  modules: defaultModulesFor('home_service'),
  capabilities: { ...defaultCapabilityFlags(), in_market: 'on' },
});
const labels = liveNav.map((item) => item.label);
assert.equal(labels.indexOf('In market'), labels.indexOf('Overview') + 1);
assert.ok(labels.indexOf('In market') < labels.indexOf('Suggestions'));
assert.equal(liveNav.find((item) => item.id === 'in_market')?.href, '/ads/in-market');
assert.equal(liveNav.find((item) => item.id === 'in_market')?.rail, 'In market');
const recommendOnly = resolveAdsNav({
  shell: 'inShell',
  modules: defaultModulesFor('home_service'),
  capabilities: { ...defaultCapabilityFlags(), in_market: 'recommend_only' },
});
assert.equal(recommendOnly.some((item) => item.id === 'in_market'), true);

assert.deepEqual(inMarketChip('ENABLED'), { chip: 'Active', label: 'Active' });
assert.deepEqual(inMarketChip('CAMPAIGN_PAUSED'), { chip: 'Paused', label: 'Paused' });
assert.deepEqual(inMarketChip('LEARNING_LIMITED'), { chip: 'Limited', label: 'Limited' });
assert.deepEqual(inMarketChip('REMOVED'), { chip: 'Off', label: 'Off' });
assert.deepEqual(inMarketChip('DISAPPROVED'), { chip: 'Unknown', label: 'DISAPPROVED' });

assert.equal(IN_MARKET_EMPTY_META, 'Nothing is running on Meta right now.');
assert.equal(IN_MARKET_EMPTY_GOOGLE, 'Nothing is running on Google right now.');
assert.equal(IN_MARKET_CONNECT_META, "Connect Meta in Settings to see what's live.");
assert.equal(IN_MARKET_CONNECT_GOOGLE, "Connect Google Ads in Settings to see what's live.");
assert.equal(IN_MARKET_LOAD_ERROR, "Couldn't load live inventory. Try again.");
assert.equal(IN_MARKET_HELPER, "To change something that's running, use Recommendations, then Approve.");
assert.equal(IN_MARKET_OPEN_META, 'Open in Meta');
assert.equal(IN_MARKET_OPEN_GOOGLE, 'Open in Google Ads');

const meta = buildInMarketView({
  now,
  window: '7d',
  accounts: [account({ id: 'meta-1', platform: 'meta', externalId: 'act_100' })],
  entities: [
    entity({ id: 'c1', entityType: 'campaign', externalId: '11', name: 'HVAC leads', status: 'ACTIVE' }),
    entity({
      id: 's1',
      entityType: 'adset',
      externalId: '22',
      name: 'Service area',
      status: 'PAUSED',
      parentExternalId: '11',
      raw: { updated_time: recent },
      syncedAt: old,
    }),
    entity({
      id: 'a1',
      entityType: 'ad',
      externalId: '33',
      name: 'Tune-up',
      status: 'ACTIVE',
      parentExternalId: '22',
    }),
    entity({
      id: 'c-old',
      entityType: 'campaign',
      externalId: '44',
      name: 'Old pause',
      status: 'PAUSED',
      raw: { updated_time: old },
      syncedAt: recent,
    }),
    entity({
      id: 'c-sync',
      entityType: 'campaign',
      externalId: '55',
      name: 'Synced pause',
      status: 'paused',
      syncedAt: recent,
      raw: {},
    }),
    entity({
      id: 'c-stale',
      entityType: 'campaign',
      externalId: '66',
      name: 'Stale pause',
      status: 'paused',
      syncedAt: old,
      raw: {},
    }),
    entity({
      id: 'c-off',
      entityType: 'campaign',
      externalId: '77',
      name: 'Archived',
      status: 'ARCHIVED',
    }),
    entity({
      id: 'c-limited',
      entityType: 'campaign',
      externalId: '88',
      name: 'Learning',
      status: 'LEARNING_LIMITED',
    }),
  ],
  metrics: [
    { entityId: 'c1', window: '7d', spendUsd: '100.00', impressions: 1000, clicks: 50, conversions: '4' },
    { entityId: 'c1', window: '30d', spendUsd: '400.00', impressions: 4000, clicks: 80, conversions: '10' },
    { entityId: 'a1', window: '7d', spendUsd: '20.00', impressions: 200, clicks: 10, conversions: '1' },
  ],
});

assert.equal(meta.platforms.length, 1);
assert.equal(meta.platforms[0]?.platform, 'meta');
assert.equal(meta.pauseClock, 'mixed');
assert.equal(meta.platforms[0]?.empty, false);
assert.match(meta.platforms[0]?.staleLabel ?? '', /^Last updated /);
const names = meta.platforms[0]?.accounts[0]?.campaigns.map((row) => row.name);
assert.deepEqual(names, ['HVAC leads', 'Synced pause']);
const hvac = meta.platforms[0]?.accounts[0]?.campaigns.find((row) => row.name === 'HVAC leads');
assert.equal(hvac?.chipLabel, 'Active');
assert.equal(hvac?.metrics.spendUsd, '100.00');
assert.equal(hvac?.metrics.resultCount, '4');
assert.equal(hvac?.metrics.costUsd, '25.00');
assert.equal(hvac?.metrics.resultLabel, 'Results');
assert.equal(hvac?.metrics.costLabel, 'Cost per result');
assert.equal(hvac?.levelLabel, 'Campaign');
assert.equal(
  hvac?.deepLink,
  'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=100&selected_campaign_ids=11',
);
assert.equal(hvac?.deepLinkLabel, 'Open in Meta');
assert.equal(hvac?.children[0]?.levelLabel, 'Ad set');
assert.equal(hvac?.children[0]?.chipLabel, 'Paused');
assert.equal(hvac?.children[0]?.children[0]?.name, 'Tune-up');
assert.equal(hvac?.children[0]?.children[0]?.metrics.costUsd, '20.00');
const syncedPause = meta.platforms[0]?.accounts[0]?.campaigns.find((row) => row.name === 'Synced pause');
assert.equal(syncedPause?.chipLabel, 'Paused');

const thirty = buildInMarketView({
  now,
  window: '30d',
  accounts: [account({ id: 'meta-1', platform: 'meta', externalId: 'act_100' })],
  entities: [entity({ id: 'c1', entityType: 'campaign', externalId: '11', name: 'HVAC leads', status: 'active' })],
  metrics: [
    { entityId: 'c1', window: '7d', spendUsd: '100.00', impressions: 1000, clicks: 50, conversions: '4' },
    { entityId: 'c1', window: '30d', spendUsd: '400.00', impressions: 4000, clicks: 80, conversions: '10' },
  ],
});
assert.equal(thirty.platforms[0]?.accounts[0]?.campaigns[0]?.metrics.spendUsd, '400.00');
assert.equal(thirty.platforms[0]?.accounts[0]?.campaigns[0]?.metrics.costUsd, '40.00');

const today = buildInMarketView({
  now,
  window: 'today',
  accounts: [account({ id: 'meta-1', platform: 'meta', externalId: 'act_100' })],
  entities: [entity({ id: 'c1', entityType: 'campaign', externalId: '11', name: 'HVAC leads', status: 'active' })],
  metrics: [{ entityId: 'c1', window: '7d', spendUsd: '100.00', impressions: 1000, clicks: 50, conversions: '4' }],
});
assert.equal(today.platforms[0]?.accounts[0]?.campaigns[0]?.metrics.hasMetrics, false);

const empty = buildInMarketView({
  now,
  accounts: [account({ id: 'meta-1', platform: 'meta' })],
  entities: [entity({ id: 'c-off', entityType: 'campaign', externalId: '77', name: 'Archived', status: 'ARCHIVED' })],
  metrics: [],
});
assert.equal(empty.platforms[0]?.empty, true);
assert.equal(empty.platforms[0]?.emptyCopy, IN_MARKET_EMPTY_META);

const googleOnly = buildInMarketView({
  now,
  accounts: [account({ id: 'g1', platform: 'google', externalId: 'customers/200', displayName: 'Search' })],
  entities: [
    entity({
      id: 'gc',
      adAccountId: 'g1',
      platform: 'google',
      entityType: 'campaign',
      externalId: '900',
      name: 'Search leads',
      status: 'ENABLED',
    }),
    entity({
      id: 'gg',
      adAccountId: 'g1',
      platform: 'google',
      entityType: 'ad_group',
      externalId: '901',
      name: 'Exact',
      status: 'ENABLED',
      parentExternalId: '900',
    }),
    entity({
      id: 'ga',
      adAccountId: 'g1',
      platform: 'google',
      entityType: 'ad',
      externalId: '902',
      name: 'Ad one',
      status: 'PAUSED',
      parentExternalId: '901',
      raw: { pausedAt: recent },
    }),
    entity({
      id: 'gk',
      adAccountId: 'g1',
      platform: 'google',
      entityType: 'keyword',
      externalId: '903',
      name: 'ductless',
      status: 'ENABLED',
      parentExternalId: '901',
    }),
  ],
  metrics: [{ entityId: 'gc', window: '7d', spendUsd: '50.00', impressions: 500, clicks: 20, conversions: '2' }],
});
assert.equal(googleOnly.platforms.length, 1);
assert.equal(googleOnly.platforms[0]?.label, 'Google');
const search = googleOnly.platforms[0]?.accounts[0]?.campaigns[0];
assert.equal(search?.metrics.resultLabel, 'Conversions');
assert.equal(search?.metrics.costLabel, 'Cost per conversion');
assert.equal(search?.metrics.costUsd, '25.00');
assert.equal(search?.deepLink, 'https://ads.google.com/aw/campaigns?campaignId=900');
assert.equal(search?.deepLinkLabel, 'Open in Google Ads');
assert.equal(search?.children[0]?.levelLabel, 'Ad group');
assert.equal(
  search?.children[0]?.deepLink,
  'https://ads.google.com/aw/adgroups?campaignId=900&adGroupId=901',
);
assert.equal(search?.children[0]?.children[0]?.chipLabel, 'Paused');
assert.equal(
  search?.children[0]?.children[0]?.deepLink,
  'https://ads.google.com/aw/ads?campaignId=900&adGroupId=901&adId=902',
);
assert.equal(search?.children[0]?.children.length, 1);

assert.equal(
  inMarketDeepLink({
    platform: 'meta',
    accountExternalId: 'act_mock-pilot',
    entityType: 'campaign',
    externalId: 'meta-camp-1',
  }),
  null,
);
assert.equal(
  inMarketDeepLink({
    platform: 'google',
    accountExternalId: 'customers/200',
    entityType: 'ad',
    externalId: '902',
    parentExternalId: '901',
  }),
  null,
);

const disconnected = buildInMarketView({
  now,
  accounts: [account({ id: 'g1', platform: 'google', connectionStatus: 'disconnected', hasCredentials: false })],
  entities: [
    entity({
      id: 'gc',
      adAccountId: 'g1',
      platform: 'google',
      entityType: 'campaign',
      externalId: '900',
      name: 'Hidden',
      status: 'ENABLED',
    }),
  ],
  metrics: [],
});
assert.equal(disconnected.platforms.length, 0);

const page = readFileSync(new URL('../app/ads/in-market/page.tsx', import.meta.url), 'utf8');
const tree = readFileSync(new URL('../components/ads/in-market-tree.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../../apps/ads/api/src/in-market.ts', import.meta.url), 'utf8');
for (const source of [page, tree]) {
  assert.equal(source.includes('recommendation-actions'), false);
  assert.equal(source.includes('/decide'), false);
  assert.equal(source.includes('method: "POST"'), false);
  assert.equal(source.includes("method: 'POST'"), false);
}
assert.match(route, /app\.get\("\/clients\/:id\/in-market"/);
assert.equal(route.includes('app.post'), false);
assert.equal(route.includes('requireWritableCapability'), false);
assert.match(page, /IN_MARKET_LOAD_ERROR/);
assert.match(page, /IN_MARKET_EMPTY_META|emptyCopy/);

console.log('in-market: ok');
