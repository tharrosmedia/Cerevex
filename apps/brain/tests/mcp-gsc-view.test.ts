import assert from 'node:assert/strict';
import { projectMcpBrainRead } from '@cerevex/contracts';
import { handleMcpBrainRead, type McpBrainReadDeps } from '../src/lib/mcp/read-handler';
import { loadMcpReadPage } from '../src/lib/mcp/read-rows';
import type { Sql } from '../src/lib/mcp/read-grant';

const KEY = 'brain-read-internal-key';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const STORE = '44444444-4444-4444-8444-444444444444';
const WORKSPACE = '55555555-5555-4555-8555-555555555555';
const DATES = { dateStart: '2026-09-19', dateEnd: '2026-10-16' };

const source = [
  { query: 'heat pump', page: 'https://example.com/heat', clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
  { query: 'person@example.com', page: 'https://example.com/secret', clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
  { query: 'mini split', page: 'https://example.com/mini', clicks: 2, impressions: 10, ctr: 0.2, position: 6 },
];

const sql: Sql = async (strings, ...values) => {
  const text = strings.join(' ');
  if (text.includes('max(created_at)')) return [{ synced: '2026-10-16T12:00:00.000Z' }];
  if (!text.includes('SELECT query, page')) return [];
  const offset = Number(values[3]);
  const limit = Number(values[4]);
  return source.slice(offset, offset + limit);
};

const first = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 2,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
  ...DATES,
  view: 'both',
  gscVisible: true,
});
assert.deepEqual(first.queries, [
  { query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
  { query: 'person@example.com', clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
]);
assert.deepEqual(first.pages, [
  { page: 'https://example.com/heat', clicks: 3, impressions: 30, ctr: 0.1, position: 4 },
  { page: 'https://example.com/secret', clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
]);
assert.equal(first.nextCursor, 'gq2');
const projected = projectMcpBrainRead(
  { tool: 'get_gsc_performance', clientId: CLIENT, limit: 2, ...DATES, view: 'both' },
  {
    clientId: CLIENT,
    storeId: STORE,
    lastSyncedAt: first.lastSyncedAt,
    sourceSystem: 'brain',
    availability: 'ready',
    limit: 2,
    nextCursor: first.nextCursor,
    queries: first.queries,
    pages: first.pages,
  },
);
assert.ok(projected);
assert.equal(JSON.stringify(projected).includes('person@example.com'), false);
assert.deepEqual(projected.queries, [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.equal(projected.pages?.length, 2);

const second = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 2,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 2 },
  ...DATES,
  view: 'both',
  gscVisible: true,
});
assert.deepEqual(second.queries, [{ query: 'mini split', clicks: 2, impressions: 10, ctr: 0.2, position: 6 }]);
assert.deepEqual(second.pages, [{ page: 'https://example.com/mini', clicks: 2, impressions: 10, ctr: 0.2, position: 6 }]);
assert.equal(second.nextCursor, null);

const wrongSide = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 2,
  cursor: { tool: 'get_gsc_performance', side: 'pages', offset: 0 },
  ...DATES,
  view: 'both',
  gscVisible: true,
});
assert.deepEqual(wrongSide.queries, []);
assert.deepEqual(wrongSide.pages, []);

let seen: { view?: string; side?: string } | null = null;
const headers = { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' };
const visible = { capabilities: { 'seo.gsc.recommendations': 'on' } };
const deps: McpBrainReadDeps = {
  keyMatches: (provided) => provided === KEY,
  workspaceId: () => WORKSPACE,
  async loadGrant() {
    return { ok: true, siteId: STORE, workspaceSettings: visible, clientSettings: visible };
  },
  async loadPage(input) {
    seen = { view: input.view, side: input.cursor.tool === 'get_gsc_performance' ? input.cursor.side : undefined };
    return {
      queries: [],
      pages: [{ page: 'https://example.com/heat', clicks: 1, impressions: 4, ctr: 0.25, position: 2 }],
      findings: [],
      products: [],
      collections: [],
      lastSyncedAt: '2026-10-16T12:00:00.000Z',
      nextCursor: null,
    };
  },
  log() {},
};

function url(view: string, cursor = ''): string {
  const cursorParam = cursor ? `&cursor=${cursor}` : '';
  return `http://brain.test/api/internal/mcp/read?tool=get_gsc_performance&identityId=${IDENTITY}&clientId=${CLIENT}&dateStart=${DATES.dateStart}&dateEnd=${DATES.dateEnd}&view=${view}${cursorParam}`;
}

const pages = await handleMcpBrainRead(new Request(url('pages'), { headers }), deps);
assert.equal(pages.status, 200);
assert.deepEqual(seen, { view: 'pages', side: 'pages' });
const pagesBody = await pages.json() as { read: { pages: unknown[]; queries?: unknown[]; view: string } };
assert.equal(pagesBody.read.view, 'pages');
assert.deepEqual(pagesBody.read.pages, [{ page: 'https://example.com/heat', clicks: 1, impressions: 4, ctr: 0.25, position: 2 }]);
assert.equal(pagesBody.read.queries, undefined);

const mixed = await handleMcpBrainRead(new Request(url('pages', 'gq0'), { headers }), deps);
assert.equal(mixed.status, 400);

const bothCursor = await handleMcpBrainRead(new Request(url('both', 'gp0'), { headers }), deps);
assert.equal(bothCursor.status, 400);

console.log('mcp-gsc-view: ok');
