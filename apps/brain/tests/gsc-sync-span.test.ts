import assert from 'node:assert/strict';
import { MCP_GSC_MAX_RANGE_DAYS, mcpDefaultGscRange, mcpInclusiveDays, mcpUtcDay } from '@cerevex/contracts';
import { gscSyncSpan } from '../src/lib/gsc/client';
import { loadMcpReadPage } from '../src/lib/mcp/read-rows';
import type { Sql } from '../src/lib/mcp/read-grant';

const STORE = '44444444-4444-4444-8444-444444444444';
const NOW = Date.UTC(2026, 9, 17, 15, 0, 0);
const DAY_MS = 86400000;

const span = gscSyncSpan(28, NOW);
const range = mcpDefaultGscRange(NOW);
const stored = {
  date_start: span.dateStart,
  date_end: span.dateEnd,
  query: 'heat pump',
  page: 'https://example.com/heat',
  clicks: 3,
  impressions: 30,
  ctr: 0.1,
  position: 4,
};
assert.equal(MCP_GSC_MAX_RANGE_DAYS, 28);
assert.equal(mcpInclusiveDays(stored.date_start, stored.date_end), 28);
assert.deepEqual(span, { dateStart: range.dateStart, dateEnd: range.dateEnd });
assert.equal(stored.date_start, '2026-09-20');
assert.equal(stored.date_end, '2026-10-17');

function contained(row: { date_start: string; date_end: string }, dateStart: string, dateEnd: string) {
  return row.date_start >= dateStart && row.date_end <= dateEnd;
}

const sql: Sql = async (strings, ...values) => {
  const text = strings.join(' ');
  if (text.includes('max(created_at)')) return [{ synced: '2026-10-17T12:00:00.000Z' }];
  if (!text.includes('FROM gsc_rows')) return [];
  assert.match(text, /date_start >=/);
  assert.match(text, /date_end <=/);
  const dates = values.filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  assert.deepEqual(dates, [range.dateStart, range.dateEnd]);
  if (!contained(stored, range.dateStart, range.dateEnd)) return [];
  const metrics = {
    clicks: stored.clicks,
    impressions: stored.impressions,
    ctr: stored.ctr,
    position: stored.position,
  };
  if (text.includes('SELECT query, page')) return [{ query: stored.query, page: stored.page, ...metrics }];
  if (text.includes('SELECT page')) return [{ page: stored.page, ...metrics }];
  if (text.includes('SELECT query')) return [{ query: stored.query, ...metrics }];
  return [];
};

const byDefault = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
  dateStart: range.dateStart,
  dateEnd: range.dateEnd,
  gscVisible: true,
});
assert.deepEqual(byDefault.queries, [{ query: stored.query, clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);
assert.deepEqual(byDefault.pages, [{ page: stored.page, clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);

const byPages = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'pages', offset: 0 },
  dateStart: range.dateStart,
  dateEnd: range.dateEnd,
  view: 'pages',
  gscVisible: true,
});
assert.deepEqual(byPages.queries, []);
assert.deepEqual(byPages.pages, [{ page: stored.page, clicks: 3, impressions: 30, ctr: 0.1, position: 4 }]);

const endMs = mcpUtcDay(range.dateEnd);
assert.ok(endMs != null);
stored.date_start = new Date(endMs - MCP_GSC_MAX_RANGE_DAYS * DAY_MS).toISOString().slice(0, 10);
assert.equal(mcpInclusiveDays(stored.date_start, stored.date_end), null);

const overDefault = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
  dateStart: range.dateStart,
  dateEnd: range.dateEnd,
  gscVisible: true,
});
const overPages = await loadMcpReadPage(sql, {
  tool: 'get_gsc_performance',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_gsc_performance', side: 'pages', offset: 0 },
  dateStart: range.dateStart,
  dateEnd: range.dateEnd,
  view: 'pages',
  gscVisible: true,
});
assert.deepEqual(overDefault.queries, []);
assert.deepEqual(overDefault.pages, []);
assert.deepEqual(overPages.queries, []);
assert.deepEqual(overPages.pages, []);
assert.equal(overDefault.nextCursor, null);
assert.equal(overPages.nextCursor, null);

console.log('gsc-sync-span: ok');
