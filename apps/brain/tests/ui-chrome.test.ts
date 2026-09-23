import assert from 'node:assert/strict';
import { SEO_NAV } from '../lib/seo-nav';
import { SETTINGS_SECTIONS } from '../lib/settings-nav';
import { operatorLoadError } from '../lib/ui-copy';

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

assert.equal(
  operatorLoadError("No database connection string was provided to `neon()`."),
  'Could not load store data. Check the database connection, then refresh.',
);
assert.equal(operatorLoadError('Token expired'), 'Token expired');

console.log('ui-chrome: ok');
