import assert from 'node:assert/strict';
import { handleMcpBrainRead, type McpBrainReadDeps } from '../src/lib/mcp/read-handler';
import { loadMcpReadPage } from '../src/lib/mcp/read-rows';
import type { Sql } from '../src/lib/mcp/read-grant';

const KEY = 'brain-read-internal-key';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const STORE = '44444444-4444-4444-8444-444444444444';
const WORKSPACE = '55555555-5555-4555-8555-555555555555';

const CURRENT = { dateStart: '2026-09-19', dateEnd: '2026-10-16' };
const PRIOR = { dateStart: '2026-08-22', dateEnd: '2026-09-18' };

function rowQuery(text: string): boolean {
  return text.includes('FROM gsc_rows') && text.includes('SELECT query');
}

function assertContained(text: string) {
  assert.match(text, /date_start >=/);
  assert.match(text, /date_end <=/);
  assert.equal(text.includes('date_end >='), false);
  assert.equal(text.includes('date_start <='), false);
}

const calls: { text: string; values: unknown[] }[] = [];
const sql: Sql = async (strings, ...values) => {
  const text = strings.join(' ');
  calls.push({ text, values });
  if (text.includes('max(created_at)')) return [{ synced: '2026-10-16T12:00:00.000Z' }];
  if (rowQuery(text)) {
    const start = values.find((value) => value === CURRENT.dateStart || value === PRIOR.dateStart);
    const query = start === CURRENT.dateStart ? 'heat pump' : 'old furnace';
    return [{ query, clicks: 3, impressions: 30, ctr: 0.1, position: 4 }];
  }
  return [];
};

const current = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
  ...CURRENT,
  view: 'queries',
  gscVisible: true,
});
const prior = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
  ...PRIOR,
  view: 'queries',
  gscVisible: true,
});

const rowCalls = calls.filter((call) => rowQuery(call.text));
assert.equal(rowCalls.length, 2);
for (const call of rowCalls) assertContained(call.text);
assert.deepEqual(
  rowCalls.map((call) => call.values.filter((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))),
  [
    [CURRENT.dateStart, CURRENT.dateEnd],
    [PRIOR.dateStart, PRIOR.dateEnd],
  ],
);
assert.deepEqual(current.queries, [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.deepEqual(prior.queries, [{ query: 'old furnace', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.notDeepEqual(current.queries, prior.queries);

const beforeReversed = calls.length;
const reversed = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
  dateStart: '2026-10-16',
  dateEnd: '2026-09-19',
  view: 'queries',
  gscVisible: true,
});
assert.equal(calls.length, beforeReversed);
assert.deepEqual(reversed.queries, []);
assert.equal(reversed.nextCursor, null);

const sameDay = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'pages', offset: 0 },
  dateStart: '2026-10-16',
  dateEnd: '2026-10-16',
  view: 'pages',
  gscVisible: true,
});
const pageCall = calls.filter((call) => call.text.includes('SELECT page')).at(-1);
assert.ok(pageCall);
assertContained(pageCall.text);
assert.deepEqual(
  pageCall.values.filter((value) => value === '2026-10-16'),
  ['2026-10-16', '2026-10-16'],
);
assert.deepEqual(sameDay.pages, []);

let loaded = 0;
const headers = { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' };
const deps: McpBrainReadDeps = {
  keyMatches: (provided) => provided === KEY,
  workspaceId: () => WORKSPACE,
  async loadGrant() {
    return {
      ok: true,
      siteId: STORE,
      workspaceSettings: { capabilities: { 'seo.gsc.recommendations': 'on' } },
      clientSettings: { capabilities: { 'seo.gsc.recommendations': 'on' } },
    };
  },
  async loadPage() {
    loaded += 1;
    return {
      queries: [],
      pages: [],
      findings: [],
      products: [],
      collections: [],
      lastSyncedAt: null,
      nextCursor: null,
    };
  },
  log() {},
};

function readUrl(start: string, end: string): string {
  return `http://brain.test/api/internal/mcp/read?tool=get_gsc_performance&identityId=${IDENTITY}&clientId=${CLIENT}&dateStart=${start}&dateEnd=${end}&view=queries`;
}

const rejected = await handleMcpBrainRead(new Request(readUrl('2026-10-16', '2026-09-19'), { headers }), deps);
assert.equal(rejected.status, 400);
assert.equal(await rejected.text(), JSON.stringify({ ok: false }));
assert.equal(loaded, 0);

const accepted = await handleMcpBrainRead(new Request(readUrl('2026-10-16', '2026-10-16'), { headers }), deps);
assert.equal(accepted.status, 200);
assert.equal(loaded, 1);

console.log('mcp-gsc-date-filter: ok');
