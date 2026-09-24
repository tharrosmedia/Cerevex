import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatGscCtr,
  formatGscPosition,
  gscPagePath,
  gscQueryText,
  sortGscRowsByClicks,
} from '../src/lib/gsc/display';

assert.equal(gscQueryText('hvacusa ac repair near me'), 'hvacusa ac repair near me');
assert.equal(gscQueryText('  hvacusa  '), 'hvacusa');
assert.equal(gscQueryText(''), '—');
assert.equal(gscQueryText(null), '—');

assert.equal(gscPagePath('https://hvacusa.store/collections/ac-repair'), '/collections/ac-repair');
assert.equal(gscPagePath('https://hvacusa.store/'), '/');
assert.equal(gscPagePath('https://hvacusa.store'), '/');
assert.equal(gscPagePath('https://hvacusa.store/pages/financing?utm=gsc'), '/pages/financing?utm=gsc');
assert.equal(gscPagePath('/already/a/path'), '/already/a/path');
assert.equal(gscPagePath(''), '—');
assert.equal(gscPagePath(null), '—');

assert.equal(formatGscCtr(0.035), '3.5%');
assert.equal(formatGscCtr(0), '0.0%');
assert.equal(formatGscCtr(null), '—');
assert.equal(formatGscPosition(8.21), '8.2');
assert.equal(formatGscPosition(null), '—');

const sorted = sortGscRowsByClicks([
  { query: 'low clicks high impr', clicks: 1, impressions: 900 },
  { query: 'hvacusa ac repair near me', clicks: 42, impressions: 200 },
  { query: 'hvacusa', clicks: 42, impressions: 800 },
  { query: 'no traffic', clicks: 0, impressions: 12 },
]);
assert.deepEqual(
  sorted.map((row) => row.query),
  ['hvacusa', 'hvacusa ac repair near me', 'low clicks high impr', 'no traffic'],
);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(join(root, 'app/seo/search/page.tsx'), 'utf8');
assert.match(page, /GscSearchRows/);
assert.doesNotMatch(page, /data-label="Query"/);
assert.match(page, /Sorted by clicks, then impressions/);

const list = readFileSync(join(root, 'src/lib/db/gsc.ts'), 'utf8');
assert.match(list, /ORDER BY clicks DESC NULLS LAST, impressions DESC NULLS LAST/);
assert.doesNotMatch(list, /ORDER BY date_end DESC, impressions DESC/);

const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
assert.match(css, /\.table-wrap\.gsc-rows/);
assert.match(css, /overflow-wrap:\s*anywhere/);
assert.match(css, /\.gsc-row-metrics/);
assert.doesNotMatch(css, /\.gsc-row-query[\s\S]{0,120}text-overflow:\s*ellipsis/);

const rows = readFileSync(join(root, 'components/gsc-search-rows.tsx'), 'utf8');
assert.match(rows, /gsc-row-query/);
assert.match(rows, /gsc-row-metrics/);
assert.match(rows, /title=\{page/);
assert.doesNotMatch(rows, /truncate|ellipsis|slice\(0/);

console.log('gsc-search: ok');
