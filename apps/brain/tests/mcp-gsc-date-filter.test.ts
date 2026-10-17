import assert from 'node:assert/strict';
import { mcpDefaultGscRange } from '@cerevex/contracts';
import { gscSyncSpan } from '../src/lib/gsc/client';
import { handleMcpBrainRead, type McpBrainReadDeps } from '../src/lib/mcp/read-handler';
import { loadMcpReadPage } from '../src/lib/mcp/read-rows';
import type { Sql } from '../src/lib/mcp/read-grant';

const KEY = 'brain-read-internal-key';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const STORE = '44444444-4444-4444-8444-444444444444';
const WORKSPACE = '55555555-5555-4555-8555-555555555555';

const READ_AT = Date.UTC(2026, 9, 17, 16, 0, 0);
const SYNCED_AT = Date.UTC(2026, 9, 14, 16, 0, 0);
const requested = mcpDefaultGscRange(READ_AT);
const recent = gscSyncSpan(28, SYNCED_AT);
assert.equal(recent.dateEnd < requested.dateEnd, true);
assert.equal(recent.dateStart < requested.dateStart, true);

type Stored = {
  date_start: string;
  date_end: string;
  created_at: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

const table: Stored[] = [
  {
    date_start: '2026-08-14',
    date_end: '2026-09-10',
    created_at: '2026-09-10T12:00:00.000Z',
    query: 'old furnace',
    page: 'https://example.com/old',
    clicks: 1,
    impressions: 8,
    ctr: 0.125,
    position: 9,
  },
  {
    date_start: '2026-09-04',
    date_end: '2026-10-01',
    created_at: '2026-10-01T12:00:00.000Z',
    query: 'mini split',
    page: 'https://example.com/mini',
    clicks: 2,
    impressions: 10,
    ctr: 0.2,
    position: 6,
  },
  {
    date_start: recent.dateStart,
    date_end: recent.dateEnd,
    created_at: '2026-10-14T12:00:00.000Z',
    query: 'heat pump',
    page: 'https://example.com/heat',
    clicks: 3,
    impressions: 30,
    ctr: 0.1,
    position: 4,
  },
];

function days(values: unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function assertNewestSpan(text: string) {
  assert.match(text, /date_start <=/);
  assert.match(text, /date_end >=/);
  assert.match(text, /date_end <=/);
  assert.match(text, /GROUP BY date_start, date_end/);
  assert.match(text, /ORDER BY date_end DESC, max\(created_at\) DESC/);
  assert.equal(/date_start >=/.test(text), false);
}

function chosen(dateStart: string, dateEnd: string): Stored | null {
  const groups = new Map<string, Stored>();
  for (const row of table) {
    if (row.date_start > dateEnd || row.date_end < dateStart || row.date_end > dateEnd) continue;
    const key = `${row.date_start}|${row.date_end}`;
    const prev = groups.get(key);
    if (!prev || row.created_at > prev.created_at) groups.set(key, row);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.date_end !== right.date_end) return left.date_end < right.date_end ? 1 : -1;
    return left.created_at < right.created_at ? 1 : -1;
  })[0] ?? null;
}

const sql: Sql = async (strings, ...values) => {
  const text = strings.join(' ');
  if (text.includes('AS synced')) return [{ synced: '2026-10-14T12:00:00.000Z' }];
  assertNewestSpan(text);
  const dates = days(values);
  assert.deepEqual(dates, [values[2], values[3], values[2]]);
  const dateEnd = dates[0];
  const dateStart = dates[1];
  assert.equal(typeof dateStart, 'string');
  assert.equal(typeof dateEnd, 'string');
  const span = dateStart && dateEnd ? chosen(dateStart, dateEnd) : null;
  if (!span) return [];
  const offset = Number(values.at(-2));
  const limit = Number(values.at(-1));
  return table
    .filter((row) => row.date_start === span.date_start && row.date_end === span.date_end)
    .slice(offset, offset + limit);
};

function read(dateStart: string, dateEnd: string, view: 'queries' | 'pages' | 'both') {
  return loadMcpReadPage(sql, {
    tool: 'get_gsc_performance',
    storeId: STORE,
    limit: 10,
    cursor: { tool: 'get_gsc_performance', side: view === 'pages' ? 'pages' : 'queries', offset: 0 },
    dateStart,
    dateEnd,
    view,
    gscVisible: true,
  });
}

const byQueries = await read(requested.dateStart, requested.dateEnd, 'queries');
assert.deepEqual(byQueries.queries, [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.deepEqual(byQueries.pages, []);
assert.equal(byQueries.dateStart, recent.dateStart);
assert.equal(byQueries.dateEnd, recent.dateEnd);

const byPages = await read(requested.dateStart, requested.dateEnd, 'pages');
assert.deepEqual(byPages.queries, []);
assert.deepEqual(byPages.pages, [{ page: 'https://example.com/heat', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.equal(byPages.dateStart, recent.dateStart);
assert.equal(byPages.dateEnd, recent.dateEnd);

const mixed = await read(requested.dateStart, requested.dateEnd, 'both');
assert.deepEqual(mixed.queries, [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.deepEqual(mixed.pages, [{ page: 'https://example.com/heat', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.equal(JSON.stringify(mixed).includes('mini split'), false);
assert.equal(JSON.stringify(mixed).includes('old furnace'), false);

const olderOnly = await read('2026-08-14', '2026-09-10', 'both');
assert.deepEqual(olderOnly.queries, [{ query: 'old furnace', clicks: 1, impressions: 8, ctr: 0.125, position: 9 }]);
assert.deepEqual(olderOnly.pages, [{ page: 'https://example.com/old', clicks: 1, impressions: 8, ctr: 0.125, position: 9 }]);
assert.equal(olderOnly.dateStart, '2026-08-14');
assert.equal(olderOnly.dateEnd, '2026-09-10');
assert.equal(JSON.stringify(olderOnly).includes('heat pump'), false);
assert.equal(JSON.stringify(olderOnly).includes('mini split'), false);

const beforeData = await read('2026-01-01', '2026-01-28', 'both');
assert.deepEqual(beforeData.queries, []);
assert.deepEqual(beforeData.pages, []);
assert.equal(beforeData.dateStart, null);
assert.equal(beforeData.dateEnd, null);
assert.equal(beforeData.nextCursor, null);

const headers = { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' };
let loaded = 0;
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
      queries: [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }],
      pages: [],
      findings: [],
      products: [],
      collections: [],
      lastSyncedAt: '2026-10-14T12:00:00.000Z',
      nextCursor: null,
      dateStart: recent.dateStart,
      dateEnd: recent.dateEnd,
    };
  },
  log() {},
};

function readUrl(start: string, end: string): string {
  return `http://brain.test/api/internal/mcp/read?tool=get_gsc_performance&identityId=${IDENTITY}&clientId=${CLIENT}&dateStart=${start}&dateEnd=${end}&view=queries`;
}

const rejected = await handleMcpBrainRead(new Request(readUrl('2026-10-17', '2026-09-20'), { headers }), deps);
assert.equal(rejected.status, 400);
assert.equal(await rejected.text(), JSON.stringify({ ok: false }));
assert.equal(loaded, 0);

const accepted = await handleMcpBrainRead(
  new Request(readUrl(requested.dateStart, requested.dateEnd), { headers }),
  deps,
);
assert.equal(accepted.status, 200);
assert.equal(loaded, 1);
const body = await accepted.json() as { read: { dateStart: string; dateEnd: string; queries: unknown[] } };
assert.equal(body.read.dateStart, recent.dateStart);
assert.equal(body.read.dateEnd, recent.dateEnd);
assert.deepEqual(body.read.queries, [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);

console.log('mcp-gsc-date-filter: ok');
