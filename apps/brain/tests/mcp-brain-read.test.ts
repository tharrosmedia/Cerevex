import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import {
  decideMcpReadAccess,
  mcpGscReadVisible,
  mcpReadLogEvent,
  projectMcpBrainRead,
  type McpReadLogEvent,
} from '@cerevex/contracts';
import { middleware } from '../middleware';
import { GET } from '../app/api/internal/mcp/read/route';
import { handleMcpBrainRead, type McpBrainReadDeps } from '../src/lib/mcp/read-handler';
import { loadMcpReadGrant, type Sql } from '../src/lib/mcp/read-grant';
import { loadMcpReadPage } from '../src/lib/mcp/read-rows';

const KEY = 'brain-read-internal-key';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const STORE = '44444444-4444-4444-8444-444444444444';
const WORKSPACE = '55555555-5555-4555-8555-555555555555';
const FINDING = '66666666-6666-4666-8666-666666666666';

const env = process.env as Record<string, string | undefined>;
const prev = {
  key: env.ADS_INTERNAL_KEY,
  workspace: env.ADS_INTERNAL_WORKSPACE_ID,
  password: env.APP_PASSWORD,
  node: env.NODE_ENV,
};

function restore() {
  if (prev.key === undefined) delete env.ADS_INTERNAL_KEY;
  else env.ADS_INTERNAL_KEY = prev.key;
  if (prev.workspace === undefined) delete env.ADS_INTERNAL_WORKSPACE_ID;
  else env.ADS_INTERNAL_WORKSPACE_ID = prev.workspace;
  if (prev.password === undefined) delete env.APP_PASSWORD;
  else env.APP_PASSWORD = prev.password;
  if (prev.node === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = prev.node;
}

function granted(clientId = CLIENT, siteId: string | null = STORE) {
  return {
    workspaceId: WORKSPACE,
    identity: { scopes: ['cerevex.read'], workspaceId: WORKSPACE, revoked: false },
    grants: [{ clientId, siteId }],
    clientId,
  };
}

const here = dirname(fileURLToPath(import.meta.url));

try {
  const messy = projectMcpBrainRead(
    {
      tool: 'get_gsc_performance',
      clientId: CLIENT,
      limit: 2,
      dateStart: '2026-09-19',
      dateEnd: '2026-10-16',
      view: 'both',
    },
    {
      clientId: CLIENT,
      storeId: STORE,
      lastSyncedAt: '2026-10-16T12:00:00.000Z',
      sourceSystem: 'brain',
      availability: 'ready',
      limit: 2,
      nextCursor: 'gp0',
      token: KEY,
      bodyHtml: '<p>secret</p>',
      detail: { email: 'person@example.com' },
      queries: [
        { query: 'person@example.com', clicks: 1, impressions: 2, ctr: 0.5, position: 1, email: 'person@example.com' },
        { query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4.256, page: 'https://secret.example/hidden' },
      ],
      pages: [{ page: 'http://example.com/insecure', clicks: 1, impressions: 1, ctr: 1, position: 1 }],
    },
  );
  assert.ok(messy);
  const messyText = JSON.stringify(messy);
  assert.equal(messyText.includes('person@example.com'), false);
  assert.equal(messyText.includes(KEY), false);
  assert.equal(messyText.includes('bodyHtml'), false);
  assert.equal(messyText.includes('detail'), false);
  assert.equal(messyText.includes('secret'), false);
  assert.equal(messyText.includes('http://'), false);
  assert.deepEqual(messy.queries, [{ query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4.256 }]);
  assert.deepEqual(messy.pages, []);
  assert.equal(messy.sourceSystem, 'brain');
  assert.equal(messy.availability, 'ready');
  assert.equal(projectMcpBrainRead(
    { tool: 'get_store_catalog', clientId: CLIENT, limit: 1 },
    { clientId: CLIENT, storeId: STORE, lastSyncedAt: null, sourceSystem: 'stub', availability: 'not_synced', limit: 1, products: [], collections: [] },
  ), null);

  const log = mcpReadLogEvent({ identityId: IDENTITY, clientId: CLIENT, tool: 'get_store_catalog', rows: 2 });
  assert.deepEqual(Object.keys(log).sort(), ['clientId', 'identityId', 'msg', 'rows', 'tool']);
  assert.equal(JSON.stringify(log).includes('query'), false);

  assert.deepEqual(decideMcpReadAccess({ ...granted(), workspaceId: null }), { ok: false });
  assert.deepEqual(decideMcpReadAccess({ ...granted(), identity: null }), { ok: false });
  assert.deepEqual(
    decideMcpReadAccess({ ...granted(), identity: { scopes: ['cerevex.read'], workspaceId: OTHER, revoked: false } }),
    { ok: false },
  );
  assert.deepEqual(
    decideMcpReadAccess({ ...granted(), identity: { scopes: ['cerevex.read'], workspaceId: WORKSPACE, revoked: true } }),
    { ok: false },
  );
  assert.deepEqual(
    decideMcpReadAccess({ ...granted(), identity: { scopes: [], workspaceId: WORKSPACE, revoked: false } }),
    { ok: false },
  );
  assert.deepEqual(
    decideMcpReadAccess({ ...granted(), identity: { scopes: 'cerevex.read', workspaceId: WORKSPACE, revoked: false } }),
    { ok: false },
  );
  assert.deepEqual(
    decideMcpReadAccess({
      ...granted(),
      identity: { scopes: ['cerevex.recs.submit'], workspaceId: WORKSPACE, revoked: false },
    }),
    { ok: false },
  );
  assert.deepEqual(decideMcpReadAccess({ ...granted(), grants: [] }), { ok: false });
  assert.deepEqual(
    decideMcpReadAccess({ ...granted(), grants: [{ clientId: OTHER, siteId: STORE }] }),
    { ok: false },
  );
  assert.deepEqual(decideMcpReadAccess(granted()), { ok: true, siteId: STORE });
  assert.deepEqual(decideMcpReadAccess(granted(CLIENT, 'not-a-store')), { ok: true, siteId: null });
  const gscOn = { capabilities: { 'seo.gsc.recommendations': 'on' } };
  const gscHidden = { capabilities: { 'seo.gsc.recommendations': 'hidden' } };
  assert.equal(mcpGscReadVisible(gscOn, gscOn), true);
  assert.equal(mcpGscReadVisible(gscHidden, gscOn), false);
  assert.equal(mcpGscReadVisible(gscOn, gscHidden), false);
  assert.equal(mcpGscReadVisible({}, {}), false);
  assert.deepEqual(
    decideMcpReadAccess({
      ...granted(),
      grants: [
        { clientId: OTHER, siteId: '77777777-7777-4777-8777-777777777777' },
        { clientId: CLIENT, siteId: STORE },
      ],
    }),
    { ok: true, siteId: STORE },
  );

  const sqlCalls: string[] = [];
  const sqlValues: unknown[][] = [];
  const sql: Sql = async (strings, ...values) => {
    sqlCalls.push(strings.join(' '));
    sqlValues.push(values);
    const text = strings.join(' ');
    if (text.includes('mcp_identities')) {
      return [{
        scopes: ['cerevex.read'],
        workspaceId: WORKSPACE,
        workspaceSettings: { capabilities: { 'seo.gsc.recommendations': 'on' } },
        clientId: CLIENT,
        clientRowId: CLIENT,
        siteId: STORE,
      }];
    }
    if (text.includes('FROM stores')) {
      return [{ config: { workspace: { capabilities: { 'seo.gsc.recommendations': 'hidden' } } } }];
    }
    throw new Error('unexpected sql');
  };
  const loaded = await loadMcpReadGrant(sql, IDENTITY, CLIENT, WORKSPACE);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.siteId, STORE);
    assert.equal(JSON.stringify(loaded).includes(OTHER), false);
  }
  assert.match(sqlCalls[0] ?? '', /os\.mcp_identity_grants/);
  assert.match(sqlCalls[0] ?? '', /i\.id =/);
  assert.match(sqlCalls[0] ?? '', /c\.workspace_id = i\.workspace_id/);
  assert.match(sqlCalls[0] ?? '', /i\.revoked_at IS NULL/);
  assert.deepEqual(sqlValues[0], [IDENTITY, WORKSPACE]);
  const deniedSql: Sql = async () => [{ scopes: ['cerevex.read'], workspaceId: WORKSPACE, workspaceSettings: {}, clientId: null, siteId: null }];
  assert.deepEqual(await loadMcpReadGrant(deniedSql, IDENTITY, CLIENT, WORKSPACE), { ok: false });
  const otherSql: Sql = async () => [{ scopes: ['cerevex.read'], workspaceId: WORKSPACE, workspaceSettings: {}, clientId: OTHER, clientRowId: OTHER, siteId: STORE }];
  assert.deepEqual(await loadMcpReadGrant(otherSql, IDENTITY, CLIENT, WORKSPACE), { ok: false });
  const foreignClientSql: Sql = async () => [{ scopes: ['cerevex.read'], workspaceId: WORKSPACE, workspaceSettings: {}, clientId: CLIENT, clientRowId: null, siteId: null }];
  assert.deepEqual(await loadMcpReadGrant(foreignClientSql, IDENTITY, CLIENT, WORKSPACE), { ok: false });

  let gscSql = 0;
  const hiddenSql: Sql = async (strings) => {
    gscSql += 1;
    assert.equal(strings.join(' ').includes('detail'), false);
    assert.equal(strings.join(' ').includes('body_html'), false);
    return [];
  };
  const hiddenPage = await loadMcpReadPage(hiddenSql, {
    tool: 'get_gsc_performance',
    storeId: STORE,
    limit: 10,
    cursor: { tool: 'get_gsc_performance', side: 'queries', offset: 0 },
    dateStart: '2026-09-19',
    dateEnd: '2026-10-16',
    view: 'both',
    gscVisible: false,
  });
  assert.equal(gscSql, 0);
  assert.deepEqual(hiddenPage.queries, []);
  assert.deepEqual(hiddenPage.pages, []);

  const findingSql: string[] = [];
  const findingValues: unknown[][] = [];
  const findingReader: Sql = async (strings, ...values) => {
    findingSql.push(strings.join(' '));
    findingValues.push(values);
    return [];
  };
  await loadMcpReadPage(findingReader, {
    tool: 'get_seo_findings',
    storeId: STORE,
    limit: 10,
    cursor: { tool: 'get_seo_findings', offset: 0 },
    status: 'open',
    gscVisible: false,
  });
  assert.match(findingSql[0] ?? '', /kind <> 'gsc_u'/);
  assert.equal((findingSql[0] ?? '').includes('detail'), false);
  assert.ok(findingValues.length >= 1);
  for (const values of findingValues) {
    assert.equal(values.includes(false), true);
    assert.equal(values.includes(true), false);
  }

  const logs: McpReadLogEvent[] = [];
  let grants = 0;
  let pages = 0;
  function deps(grant: { ok: false } | { ok: true; siteId: string | null; workspaceSettings: unknown; clientSettings: unknown }): McpBrainReadDeps {
    return {
      keyMatches: (provided) => provided === KEY,
      workspaceId: () => WORKSPACE,
      async loadGrant() {
        grants += 1;
        return grant;
      },
      async loadPage(input) {
        pages += 1;
        assert.equal(input.gscVisible, false);
        return {
          queries: [],
          pages: [],
          findings: [{ id: FINDING, kind: 'title', severity: 'high', title: 'Short title', status: 'open', handle: 'services', detail: { email: 'person@example.com' } }],
          products: [{ handle: 'mini-split', title: 'Mini split', bodyHtml: '<p>secret</p>' }],
          collections: [],
          lastSyncedAt: null,
          nextCursor: null,
        };
      },
      log(event) {
        logs.push(event);
      },
    };
  }

  const hiddenFlags = { capabilities: { 'seo.gsc.recommendations': 'hidden' } };
  const visibleFlags = { capabilities: { 'seo.gsc.recommendations': 'on' } };

  async function call(path: string, headers: Record<string, string> = {}, method = 'GET', grant = deps({ ok: false })) {
    return handleMcpBrainRead(new Request(`http://brain.test${path}`, { method, headers }), grant);
  }

  const base = `/api/internal/mcp/read?tool=get_store_catalog&identityId=${IDENTITY}&clientId=${CLIENT}&limit=10`;
  const noKey = await call(base);
  assert.equal(noKey.status, 401);
  assert.equal(grants, 0);
  const wrongKey = await call(base, { 'x-cerevex-internal-key': 'nope' });
  assert.equal(wrongKey.status, 401);
  const wrongKeyWithCaller = await call(base, { 'x-cerevex-internal-key': 'nope', 'x-cerevex-caller': 'ads-mcp-read' });
  assert.equal(wrongKeyWithCaller.status, 401);
  const queryKey = await call(`${base}&x-cerevex-internal-key=${KEY}`);
  assert.equal(queryKey.status, 401);
  const cookie = await call(base, { cookie: 'auth=console-secret' });
  assert.equal(cookie.status, 401);
  const cookieWithCaller = await call(base, { cookie: 'auth=console-secret', 'x-cerevex-caller': 'ads-mcp-read' });
  assert.equal(cookieWithCaller.status, 401);
  const noCaller = await call(base, { 'x-cerevex-internal-key': KEY });
  assert.equal(noCaller.status, 401);
  const wrongCaller = await call(base, { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'browser' });
  assert.equal(wrongCaller.status, 401);
  const posted = await call(base, { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' }, 'POST');
  assert.equal(posted.status, 405);
  const keyInUrl = await call(
    `${base}&note=${KEY}`,
    { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' },
  );
  assert.equal(keyInUrl.status, 401);
  const extraKey = await call(`${base}&apply=1`, { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' });
  assert.equal(extraKey.status, 400);
  assert.equal(grants, 0);
  for (const response of [noKey, wrongKey, wrongKeyWithCaller, queryKey, cookie, cookieWithCaller, noCaller, wrongCaller, posted, keyInUrl, extraKey]) {
    const text = await response.text();
    assert.equal(text, JSON.stringify({ ok: false }));
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes(CLIENT), false);
  }

  const missingWorkspace = handleMcpBrainRead(
    new Request(`http://brain.test${base}`, {
      headers: { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' },
    }),
    { ...deps({ ok: false }), workspaceId: () => null },
  );
  assert.equal((await missingWorkspace).status, 403);
  assert.equal(grants, 0);

  const outsider = await call(base, { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' });
  const emptyScope = await call(base, { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' });
  assert.equal(outsider.status, 403);
  assert.equal(emptyScope.status, 403);
  assert.equal(await outsider.clone().text(), await emptyScope.clone().text());
  assert.equal(await outsider.text(), JSON.stringify({ ok: false }));
  assert.equal(grants, 2);

  pages = 0;
  const hidden = await handleMcpBrainRead(
    new Request(
      `http://brain.test/api/internal/mcp/read?tool=get_gsc_performance&identityId=${IDENTITY}&clientId=${CLIENT}&limit=10&dateStart=2026-09-19&dateEnd=2026-10-16&view=both`,
      { headers: { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' } },
    ),
    deps({ ok: true, siteId: STORE, workspaceSettings: visibleFlags, clientSettings: hiddenFlags }),
  );
  assert.equal(hidden.status, 200);
  assert.equal(pages, 0);
  const hiddenBody = await hidden.json() as { read: { queries: unknown[]; pages: unknown[]; returned: number } };
  assert.deepEqual(hiddenBody.read.queries, []);
  assert.deepEqual(hiddenBody.read.pages, []);
  assert.equal(hiddenBody.read.returned, 0);
  assert.equal(JSON.stringify(hiddenBody).includes('heat pump'), false);

  const catalog = await handleMcpBrainRead(
    new Request(`http://brain.test${base}`, {
      headers: { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' },
    }),
    deps({ ok: true, siteId: STORE, workspaceSettings: hiddenFlags, clientSettings: hiddenFlags }),
  );
  assert.equal(catalog.status, 200);
  const catalogBody = await catalog.json() as { read: { products: Array<{ title: string }> } };
  assert.deepEqual(catalogBody.read.products, [{ handle: 'mini-split', title: 'Mini split' }]);
  const catalogText = JSON.stringify(catalogBody);
  assert.equal(catalogText.includes('bodyHtml'), false);
  assert.equal(catalogText.includes('secret'), false);
  assert.equal(catalogText.includes('person@example.com'), false);
  assert.equal(catalogText.includes(KEY), false);

  for (const event of logs) {
    assert.deepEqual(Object.keys(event).sort(), ['clientId', 'identityId', 'msg', 'rows', 'tool']);
    assert.equal(JSON.stringify(event).includes(KEY), false);
    assert.equal(JSON.stringify(event).includes('heat pump'), false);
    assert.equal(JSON.stringify(event).includes('secret'), false);
  }
  assert.ok(logs.some((event) => event.tool === 'get_gsc_performance' && event.rows === 0));

  env.NODE_ENV = 'production';
  env.APP_PASSWORD = 'console-secret';
  env.ADS_INTERNAL_KEY = KEY;
  const anonymous = await middleware(new NextRequest('http://localhost/api/internal/mcp/read'));
  assert.equal(anonymous.status, 401);
  const sessionOnly = await middleware(new NextRequest('http://localhost/api/internal/mcp/read', {
    headers: { cookie: 'auth=console-secret' },
  }));
  assert.notEqual(sessionOnly.status, 401);
  const realDenied = await GET(new Request('http://localhost/api/internal/mcp/read', {
    headers: { cookie: 'auth=console-secret', 'x-cerevex-internal-key': KEY },
  }));
  assert.equal(realDenied.status, 401);
  assert.equal(await realDenied.text(), JSON.stringify({ ok: false }));

  const route = readFileSync(join(here, '../app/api/internal/mcp/read/route.ts'), 'utf8');
  const grantSource = readFileSync(join(here, '../src/lib/mcp/read-grant.ts'), 'utf8');
  const rowSource = readFileSync(join(here, '../src/lib/mcp/read-rows.ts'), 'utf8');
  const clientSource = readFileSync(join(here, '../../ads/api/src/mcp-brain-client.ts'), 'utf8');
  const toolSource = readFileSync(join(here, '../../mcp/src/reads.ts'), 'utf8');
  assert.equal(route.includes('export function POST'), false);
  assert.equal(route.includes('export async function POST'), false);
  assert.equal(/\b(INSERT|UPDATE|DELETE)\b/.test(route + grantSource + rowSource), false);
  assert.match(clientSource, /method: "GET"/);
  assert.equal(clientSource.includes('method: "POST"'), false);
  assert.equal(toolSource.includes('not_synced'), false);
  assert.equal(toolSource.includes('sourceSystem: "stub"'), false);

  console.log('mcp-brain-read: ok');
} finally {
  restore();
}
