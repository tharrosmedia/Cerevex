import assert from 'node:assert/strict';
import {
  OPERATOR_CAPABILITY_CATALOG_LIST,
  OPS_ENV_REGISTRY,
  approveOperatorEmails,
  blockedUnfinishedCapabilityOns,
  canApproveApply,
  canApproveWithApply,
  capabilityOnBlockedReason,
  DEFAULT_APPROVE_OPERATOR_EMAIL,
  defaultCapabilityFlags,
  defaultModulesFor,
  envCapabilityKills,
  isApplyEnabled,
  isCapabilityInOperatorSettings,
  isLeadsProductUnfinished,
  isLeadsSurfaceVisible,
  isLegacyAdsWebAllowed,
  isPlatformSyncLiveOn,
  legacyAdsChromeLinksAllowed,
  legacyAdsWebGate,
  resolveAdsNav,
  resolveWorkspaceCapabilities,
} from '@cerevex/contracts';
import { adsSub } from '../lib/ads-nav';

const flags = defaultCapabilityFlags();
assert.equal(flags.cockpit, 'on');
assert.equal(flags.audits, 'on');
assert.equal(flags['m51.grok_creatives'], 'hidden');
assert.equal(flags['m51.brainstorm'], 'hidden');
assert.equal(flags['m52.callrail_connect'], 'hidden');
assert.equal(flags['m52.bundled_call_tracking'], 'hidden');
assert.equal(flags['m52.crm_join'], 'hidden');
assert.equal(flags['m52.clarity_connect'], 'hidden');
assert.equal(flags['m52.lp_intelligence'], 'hidden');
assert.equal(flags['sync.live'], 'on');
assert.equal(flags['shell.legacy_ads_web'], 'hidden');
assert.equal(isPlatformSyncLiveOn(flags), true);

assert.equal(isCapabilityInOperatorSettings({ id: 'cockpit', label: 'Ads cockpit', help: '', defaultState: 'on', unfinished: false, group: 'product' }), true);
assert.equal(isLeadsProductUnfinished(), false);
assert.ok(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.group === 'm51'));
assert.ok(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.id.startsWith('m51.')));
assert.ok(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.id === 'm52.callrail_connect'));
assert.ok(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.id === 'm52.bundled_call_tracking'));
assert.ok(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.id === 'm52.clarity_connect'));
assert.ok(OPERATOR_CAPABILITY_CATALOG_LIST.some((entry) => entry.id === 'm52.lp_intelligence'));
assert.equal(capabilityOnBlockedReason('m51.brainstorm', 'on'), null);
assert.equal(capabilityOnBlockedReason('m51.budget_shift', 'recommend_only'), null);
assert.equal(capabilityOnBlockedReason('cockpit', 'on'), null);
assert.deepEqual(blockedUnfinishedCapabilityOns({ 'm51.ga4_connect': 'on', audits: 'hidden' }), []);

const hiddenAudits = resolveWorkspaceCapabilities({ capabilities: { audits: 'hidden' } });
const items = adsSub('', defaultModulesFor('home_service'), hiddenAudits);
assert.ok(!items.some((item) => item.label === 'Audits'));
assert.ok(items.some((item) => item.label === 'Suggestions'));
assert.ok(!items.some((item) => item.label === 'Leads'));

const catalog = resolveAdsNav({ shell: 'inShell', modules: defaultModulesFor('agency') });
assert.deepEqual(
  catalog.filter((item) => item.rail).map((item) => item.rail),
  ['Audits', 'Suggestions', 'Clients', 'Workflows'],
);

const leadsLive = resolveAdsNav({
  shell: 'inShell',
  modules: defaultModulesFor('agency'),
  capabilities: { ...defaultCapabilityFlags(), 'm51.brainstorm': 'recommend_only' },
});
assert.ok(leadsLive.some((item) => item.label === 'Leads' && item.href === '/ads/leads'));
assert.equal(isLeadsSurfaceVisible(defaultModulesFor('home_service'), defaultCapabilityFlags()), false);
assert.equal(
  isLeadsSurfaceVisible(defaultModulesFor('home_service'), { ...defaultCapabilityFlags(), 'm51.brainstorm': 'on' }),
  true,
);
assert.equal(
  isLeadsSurfaceVisible({ ...defaultModulesFor('home_service'), leads: false }, { ...defaultCapabilityFlags(), 'm51.brainstorm': 'on' }),
  false,
);

assert.deepEqual(envCapabilityKills({ CAPABILITY_KILL: 'apply,connect.meta' }).sort(), [
  'apply',
  'connect.meta',
]);
assert.deepEqual(envCapabilityKills({ PLATFORM_SYNC_LIVE: '0', FEATURE_BID_MUTATIONS: '0' }).sort(), [
  'apply.bid',
  'sync.live',
]);
assert.equal(resolveWorkspaceCapabilities({}, { PLATFORM_SYNC_LIVE: '0' })['sync.live'], 'hidden');
assert.equal(OPS_ENV_REGISTRY.find((entry) => entry.env === 'APP_PASSWORD')?.kind, 'secret');
assert.equal(OPS_ENV_REGISTRY.find((entry) => entry.env === 'ADS_INTERNAL_KEY')?.kind, 'secret');
assert.equal(OPS_ENV_REGISTRY.find((entry) => entry.env === 'APPROVE_OPERATOR_EMAILS')?.kind, 'identity');
assert.deepEqual(approveOperatorEmails({}), [DEFAULT_APPROVE_OPERATOR_EMAIL]);
assert.equal(canApproveApply('adam@tharrosmedia.com', {}), true);
assert.equal(canApproveApply('other@tharrosmedia.com', { SEED_OWNER_EMAIL: 'other@tharrosmedia.com' }), false);

const hiddenLegacy = defaultCapabilityFlags();
assert.equal(isLegacyAdsWebAllowed(hiddenLegacy), false);
assert.equal(legacyAdsWebGate({ loading: true, authenticated: true, capabilities: hiddenLegacy }), 'loading');
assert.equal(legacyAdsWebGate({ loading: false, authenticated: false, capabilities: hiddenLegacy }), 'unauthenticated');
assert.equal(legacyAdsWebGate({ loading: false, authenticated: true, capabilities: hiddenLegacy }), 'block');
assert.equal(
  legacyAdsWebGate({
    loading: false,
    authenticated: true,
    capabilities: { ...hiddenLegacy, 'shell.legacy_ads_web': 'recommend_only' },
  }),
  'block',
);
assert.equal(
  legacyAdsWebGate({
    loading: false,
    authenticated: true,
    capabilities: { ...hiddenLegacy, 'shell.legacy_ads_web': 'on' },
  }),
  'allow',
);
assert.equal(legacyAdsChromeLinksAllowed(hiddenLegacy, { NEXT_PUBLIC_ADS_LEGACY_CHROME: '1' }), false);
assert.equal(
  legacyAdsChromeLinksAllowed({ ...hiddenLegacy, 'shell.legacy_ads_web': 'on' }, { NEXT_PUBLIC_ADS_LEGACY_CHROME: '1' }),
  true,
);
assert.equal(
  legacyAdsChromeLinksAllowed({ ...hiddenLegacy, 'shell.legacy_ads_web': 'on' }, {}),
  false,
);

const applyOn = defaultCapabilityFlags();
assert.equal(isApplyEnabled(applyOn), true);
assert.equal(canApproveWithApply(true, applyOn), true);
assert.equal(canApproveWithApply(false, applyOn), false);
assert.equal(canApproveWithApply(true, { ...applyOn, apply: 'hidden' }), false);
assert.equal(canApproveWithApply(true, { ...applyOn, apply: 'recommend_only' }), false);
assert.equal(canApproveWithApply(true, { ...applyOn, apply: 'on' }), true);

console.log('capabilities: ok');
