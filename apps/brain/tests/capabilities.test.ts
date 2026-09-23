import assert from 'node:assert/strict';
import {
  defaultCapabilityFlags,
  envCapabilityKills,
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

console.log('capabilities: ok');
