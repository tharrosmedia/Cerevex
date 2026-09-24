import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchGscSites,
  GSC_SITES_URL,
  gscPropertyFallbackHelp,
  gscSitesEmptyCopy,
  gscSitesErrorCopy,
  mergeGscPropertyOptions,
  parseGscSiteEntries,
} from '../src/lib/gsc/sites';

assert.deepEqual(parseGscSiteEntries(null), []);
assert.deepEqual(parseGscSiteEntries({}), []);
assert.deepEqual(parseGscSiteEntries({ siteEntry: 'nope' }), []);
assert.deepEqual(
  parseGscSiteEntries({
    siteEntry: [
      { siteUrl: 'https://www.cerevex.store/', permissionLevel: 'siteOwner' },
      { siteUrl: '  sc-domain:cerevex.store  ', permissionLevel: 'siteFullUser' },
      { siteUrl: '' },
      { permissionLevel: 'siteOwner' },
    ],
  }),
  [
    { siteUrl: 'https://www.cerevex.store/', permissionLevel: 'siteOwner' },
    { siteUrl: 'sc-domain:cerevex.store', permissionLevel: 'siteFullUser' },
  ],
);

assert.deepEqual(
  mergeGscPropertyOptions(['https://www.example.com/', 'sc-domain:example.com'], 'https://www.example.com/'),
  ['https://www.example.com/', 'sc-domain:example.com'],
);
assert.deepEqual(
  mergeGscPropertyOptions(['https://www.example.com/'], 'sc-domain:legacy.com'),
  ['sc-domain:legacy.com', 'https://www.example.com/'],
);
assert.deepEqual(mergeGscPropertyOptions(['https://a.com/', 'https://a.com/', ''], null), ['https://a.com/']);

assert.match(gscSitesEmptyCopy(), /no Search Console properties/);
assert.match(gscSitesErrorCopy(), /Could not load Search Console properties/);
assert.match(gscPropertyFallbackHelp(), /sc-domain:example.com/);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), GSC_SITES_URL);
    return new Response(JSON.stringify({
      siteEntry: [{ siteUrl: 'sc-domain:cerevex.store', permissionLevel: 'siteOwner' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const sites = await fetchGscSites('test-access-token');
  assert.deepEqual(sites, [{ siteUrl: 'sc-domain:cerevex.store', permissionLevel: 'siteOwner' }]);

  globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;
  await assert.rejects(() => fetchGscSites('bad'), /GSC sites\.list failed/);
} finally {
  globalThis.fetch = originalFetch;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPage = readFileSync(join(root, 'app/settings/page.tsx'), 'utf8');
assert.match(settingsPage, /GscPropertyField/);
assert.doesNotMatch(settingsPage, /placeholder="https:\/\/www\.example\.com\/ or sc-domain:example\.com"/);
const field = readFileSync(join(root, 'components/gsc-property-field.tsx'), 'utf8');
assert.match(field, /<select id="propertyUrl"/);
assert.match(field, /showFallback/);

console.log('gsc-sites: ok');
