import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
assert.ok(/\.btn-cta:active/.test(css), 'btn-cta needs :active feedback');
assert.ok(/\.btn-secondary:hover/.test(css), 'btn-secondary needs hover parity');
assert.ok(/\.btn-secondary:focus-visible/.test(css), 'btn-secondary needs focus parity');
assert.ok(/\.btn-secondary:active/.test(css), 'btn-secondary needs active parity');

const submitSrc = readFileSync(join(here, '../components/submit-button.tsx'), 'utf8');
assert.ok(submitSrc.includes('useFormStatus'));
assert.ok(submitSrc.includes('pendingLabel'));

const searchSrc = readFileSync(join(here, '../app/seo/search/page.tsx'), 'utf8');
const findingsSrc = readFileSync(join(here, '../app/seo/findings/page.tsx'), 'utf8');
const settingsSrc = readFileSync(join(here, '../app/settings/page.tsx'), 'utf8');
const capsSrc = readFileSync(join(here, '../components/workspace-capabilities-settings.tsx'), 'utf8');
assert.ok(searchSrc.includes('SubmitButton'));
assert.ok(findingsSrc.includes('SubmitButton'));
assert.ok(settingsSrc.includes('SubmitButton'));
assert.ok(capsSrc.includes('SubmitButton'));
assert.ok(capsSrc.includes('Saving…'));

const connectSrc = readFileSync(join(here, '../components/ads/connect-buttons.tsx'), 'utf8');
const checkSrc = readFileSync(join(here, '../components/ads/check-ads-button.tsx'), 'utf8');
const recActionsSrc = readFileSync(join(here, '../components/ads/recommendation-actions.tsx'), 'utf8');
const syncSrc = readFileSync(join(here, '../components/ads/sync-ads-button.tsx'), 'utf8');
const filtersSrc = readFileSync(join(here, '../components/ads/ads-filters.tsx'), 'utf8');
const syncRouteSrc = readFileSync(join(here, '../app/api/ads/sync/route.ts'), 'utf8');
assert.ok(connectSrc.includes('ADS_CONNECT_PENDING'));
assert.ok(connectSrc.includes('ADS_CONNECT_NO_CLIENT'));
assert.ok(!/if \(!clientId \|\| busy\) return;/.test(checkSrc));
assert.ok(checkSrc.includes('ADS_CHECK_NO_CLIENT'));
assert.ok(recActionsSrc.includes('ADS_APPROVE_SOFT_LAUNCH'));
assert.ok(recActionsSrc.includes('onApprove'));
assert.ok(syncSrc.includes('ADS_SYNC_PENDING'));
assert.ok(filtersSrc.includes('SubmitButton'));
assert.ok(syncRouteSrc.includes('/ad-accounts/'));
assert.ok(syncRouteSrc.includes('Connect Meta or Google first.'));

console.log('ui-chrome: ok');
