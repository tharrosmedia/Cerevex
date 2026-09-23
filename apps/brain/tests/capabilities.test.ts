import assert from 'node:assert/strict';
import {
  canApproveWithApply,
  defaultCapabilityFlags,
  envCapabilityKills,
  isApplyEnabled,
  isLegacyAdsWebAllowed,
  legacyAdsWebGate,
  resolveAdsNav,
  resolveWorkspaceCapabilities,
} from '@shopify-brain/contracts';
import { adsSub } from '../lib/ads-nav';
import { defaultModulesFor } from '@shopify-brain/contracts';

const flags = defaultCapabilityFlags();
assert.equal(flags.cockpit, 'on');
assert.equal(flags.audits, 'on');
assert.equal(flags['m51.grok_creatives'], 'hidden');
assert.equal(flags['shell.legacy_ads_web'], 'hidden');

const hiddenAudits = resolveWorkspaceCapabilities({ capabilities: { audits: 'hidden' } });
const items = adsSub('', defaultModulesFor('home_service'), hiddenAudits);
assert.ok(!items.some((item) => item.label === 'Audits'));
assert.ok(items.some((item) => item.label === 'Suggestions'));

const catalog = resolveAdsNav({ shell: 'inShell', modules: defaultModulesFor('agency') });
assert.deepEqual(
  catalog.filter((item) => item.rail).map((item) => item.rail),
  ['Audits', 'Suggestions', 'Clients', 'Leads', 'Workflows'],
);

assert.deepEqual(envCapabilityKills({ CAPABILITY_KILL: 'apply,connect.meta' }).sort(), [
  'apply',
  'connect.meta',
]);

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

const applyOn = defaultCapabilityFlags();
assert.equal(isApplyEnabled(applyOn), true);
assert.equal(canApproveWithApply(true, applyOn), true);
assert.equal(canApproveWithApply(false, applyOn), false);
assert.equal(canApproveWithApply(true, { ...applyOn, apply: 'hidden' }), false);
assert.equal(canApproveWithApply(true, { ...applyOn, apply: 'recommend_only' }), false);
assert.equal(canApproveWithApply(true, { ...applyOn, apply: 'on' }), true);

console.log('capabilities: ok');
