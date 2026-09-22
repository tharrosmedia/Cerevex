import assert from 'node:assert/strict';
import {
  defaultModulesFor,
  filterItemsByModules,
  parseWorkspaceModuleSettings,
  unboardedModules,
} from '@shopify-brain/contracts';
import { adsSub } from '../lib/ads-nav';

assert.deepEqual(defaultModulesFor('home_service'), {
  leads: true,
  clients: false,
  sales: false,
  workflows: true,
});
assert.deepEqual(defaultModulesFor('agency'), {
  leads: true,
  clients: true,
  sales: false,
  workflows: true,
});
assert.deepEqual(defaultModulesFor('ecommerce'), {
  leads: true,
  clients: false,
  sales: true,
  workflows: true,
});

const unboarded = parseWorkspaceModuleSettings({});
assert.equal(unboarded.onboardingComplete, false);
assert.deepEqual(unboarded.modules, unboardedModules());

const homeItems = adsSub('https://app.cerevex.store', defaultModulesFor('home_service'));
assert.ok(homeItems.every((item) => item.href.startsWith('/')));
assert.deepEqual(
  homeItems.filter((item) => item.rail).map((item) => item.rail),
  ['Audits', 'Suggestions', 'Leads', 'Workflows'],
);
assert.ok(homeItems.some((item) => item.label === 'Audits' && item.href === '/ads/audits'));
assert.ok(homeItems.some((item) => item.label === 'Suggestions' && item.href === '/ads/suggestions'));
assert.ok(!homeItems.some((item) => item.label === 'Clients'));
assert.ok(!homeItems.some((item) => item.label === 'Sales'));

const agencyItems = adsSub('', defaultModulesFor('agency'));
assert.ok(agencyItems.some((item) => item.label === 'Clients'));
assert.ok(!agencyItems.some((item) => item.label === 'Sales'));

const ecomItems = adsSub('', defaultModulesFor('ecommerce'));
assert.ok(ecomItems.some((item) => item.label === 'Sales'));
assert.ok(!ecomItems.some((item) => item.label === 'Clients'));

const filtered = filterItemsByModules(
  [
    { label: 'Overview' },
    { label: 'Clients', module: 'clients' as const },
    { label: 'Leads', module: 'leads' as const },
  ],
  defaultModulesFor('home_service'),
);
assert.deepEqual(filtered.map((item) => item.label), ['Overview', 'Leads']);

console.log('modules: ok');
