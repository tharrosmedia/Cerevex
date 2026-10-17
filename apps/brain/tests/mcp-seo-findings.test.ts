import assert from 'node:assert/strict';
import { projectMcpBrainRead } from '@cerevex/contracts';
import { loadMcpReadPage } from '../src/lib/mcp/read-rows';
import type { Sql } from '../src/lib/mcp/read-grant';

const CLIENT = '22222222-2222-4222-8222-222222222222';
const STORE = '82f1a547-f3df-41a9-80cd-bf2cfa270bf7';

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const rows = Array.from({ length: 20 }, (_, index) => {
  const n = index + 1;
  const handle = n === 4 ? '/' : n === 12 ? '/services/ac-repair' : n === 18 ? 'https://example.com/hidden' : `page-${n}`;
  return {
    id: id(n),
    kind: n === 5 || n === 6 ? 'gsc_u' : 'gsc_n',
    severity: 'med',
    title: 'Create a page for this search',
    status: 'open',
    handle,
    detail: {
      why: n === 9 ? 'Email person@example.com about this page' : `People search for term ${n}.`,
      query: `term ${n}`,
      page: `https://example.com/p/${n}`,
      clicks: n,
      impressions: 100 + n,
      ctr: 0.03,
      position: 8.5,
      offerIntent: 'Build the page so it can convert that request.',
      email: 'person@example.com',
      refreshTokenEnc: 'secret-token',
    },
  };
});

const sqlText: string[] = [];
const limits: number[] = [];
const sql: Sql = async (strings, ...values) => {
  const text = strings.join(' ');
  sqlText.push(text);
  if (text.includes('max(created_at)')) return [{ synced: '2026-10-16T12:00:00.000Z' }];
  const offset = Number(values[3]);
  const limit = Number(values[4]);
  limits.push(limit);
  return rows.slice(offset, offset + limit);
};

const page = await loadMcpReadPage(sql, {
  tool: 'get_seo_findings',
  storeId: STORE,
  limit: 50,
  cursor: { tool: 'get_seo_findings', offset: 0 },
  status: 'open',
  gscVisible: true,
});
assert.equal(sqlText[0]?.includes('DISTINCT'), false);
assert.equal(limits[0], 51);
assert.equal(page.findings.length, 20);
assert.equal(page.nextCursor, null);

const projected = projectMcpBrainRead(
  { tool: 'get_seo_findings', clientId: CLIENT, limit: 50, status: 'open' },
  {
    clientId: CLIENT,
    storeId: STORE,
    lastSyncedAt: page.lastSyncedAt,
    sourceSystem: 'brain',
    availability: 'ready',
    limit: 50,
    nextCursor: page.nextCursor,
    findings: page.findings,
  },
);
assert.ok(projected);
assert.equal(projected.findings?.length, 20);
assert.equal(projected.returned, 20);
const text = JSON.stringify(projected);
assert.equal(text.includes('person@example.com'), false);
assert.equal(text.includes('secret-token'), false);
assert.equal(text.includes('refreshTokenEnc'), false);
assert.equal(text.includes('"detail"'), false);

const home = projected.findings?.find((finding) => finding.id === id(4));
const path = projected.findings?.find((finding) => finding.id === id(12));
const linked = projected.findings?.find((finding) => finding.id === id(18));
const mailed = projected.findings?.find((finding) => finding.id === id(9));
assert.equal(home?.handle, '/');
assert.equal(path?.handle, '/services/ac-repair');
assert.equal(linked?.handle, null);
assert.equal(linked?.page, 'https://example.com/p/18');
assert.equal(mailed?.summary, null);
assert.equal(mailed?.recommendation, 'Build the page so it can convert that request.');
assert.equal(path?.query, 'term 12');
assert.equal(path?.page, 'https://example.com/p/12');
assert.equal(path?.clicks, 12);
assert.equal(path?.impressions, 112);
assert.equal(path?.ctr, 0.03);
assert.equal(path?.position, 8.5);
assert.equal(path?.summary, 'People search for term 12.');
assert.equal(path?.recommendation, 'Build the page so it can convert that request.');
assert.equal(projected.findings?.filter((finding) => finding.kind === 'gsc_u').length, 2);

const first = await loadMcpReadPage(sql, {
  tool: 'get_seo_findings',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_seo_findings', offset: 0 },
  status: 'open',
  gscVisible: true,
});
const second = await loadMcpReadPage(sql, {
  tool: 'get_seo_findings',
  storeId: STORE,
  limit: 10,
  cursor: { tool: 'get_seo_findings', offset: 10 },
  status: 'open',
  gscVisible: true,
});
assert.equal(first.findings.length, 10);
assert.equal(first.nextCursor, 'f10');
assert.equal(second.findings.length, 10);
assert.equal(second.nextCursor, null);
assert.equal(new Set([...first.findings, ...second.findings].map((finding) => (finding as { id: string }).id)).size, 20);

console.log('mcp-seo-findings: ok');
