import assert from 'node:assert/strict';
import { SEO_NAV } from '../lib/seo-nav';
import { SETTINGS_SECTIONS } from '../lib/settings-nav';

assert.deepEqual(
  SEO_NAV.map((item) => item.label),
  ['Overview', 'New content', 'Live catalog', 'Search Console', 'Recommendations', 'SEO jobs'],
);
assert.ok(SEO_NAV.every((item) => item.href.startsWith('/seo')));
assert.equal(new Set(SEO_NAV.map((item) => item.href)).size, SEO_NAV.length);

assert.deepEqual(
  SETTINGS_SECTIONS.map((section) => section.id),
  ['connects', 'approvals', 'modules', 'store', 'account'],
);
assert.deepEqual(
  SETTINGS_SECTIONS.map((section) => section.label),
  ['Connects', 'Approvals & autonomy', 'Modules & flags', 'Store', 'Account'],
);

console.log('ui-chrome: ok');
