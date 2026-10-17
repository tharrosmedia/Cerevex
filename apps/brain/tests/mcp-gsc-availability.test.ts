import assert from 'node:assert/strict';
import { projectMcpBrainRead } from '@cerevex/contracts';
import { handleMcpBrainRead, type McpBrainReadDeps } from '../src/lib/mcp/read-handler';

const KEY = 'brain-read-internal-key';
const IDENTITY = '11111111-1111-4111-8111-111111111111';
const CLIENT = '22222222-2222-4222-8222-222222222222';
const STORE = '44444444-4444-4444-8444-444444444444';
const WORKSPACE = '55555555-5555-4555-8555-555555555555';
const DATES = { dateStart: '2026-09-19', dateEnd: '2026-10-16' };

const hiddenFlags = { capabilities: { 'seo.gsc.recommendations': 'hidden' } };
const visibleFlags = { capabilities: { 'seo.gsc.recommendations': 'on' } };
const headers = { 'x-cerevex-internal-key': KEY, 'x-cerevex-caller': 'ads-mcp-read' };

type Page = {
  lastSyncedAt: string | null;
  queries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
};

function deps(flags: { workspace: unknown; client: unknown }, page: Page, siteId: string | null = STORE): McpBrainReadDeps {
  return {
    keyMatches: (provided) => provided === KEY,
    workspaceId: () => WORKSPACE,
    async loadGrant() {
      return { ok: true, siteId, workspaceSettings: flags.workspace, clientSettings: flags.client };
    },
    async loadPage() {
      return {
        queries: page.queries,
        pages: [],
        findings: [],
        products: [],
        collections: [],
        lastSyncedAt: page.lastSyncedAt,
        nextCursor: null,
      };
    },
    log() {},
  };
}

const url = `http://brain.test/api/internal/mcp/read?tool=get_gsc_performance&identityId=${IDENTITY}&clientId=${CLIENT}&dateStart=${DATES.dateStart}&dateEnd=${DATES.dateEnd}&view=queries`;
const query = { query: 'heat pump', clicks: 3, impressions: 30, ctr: 0.1, position: 4 };

async function availability(handler: McpBrainReadDeps): Promise<string> {
  const response = await handleMcpBrainRead(new Request(url, { headers }), handler);
  assert.equal(response.status, 200);
  const body = await response.json() as { read: { availability: string; queries: unknown[]; returned: number } };
  return JSON.stringify({ availability: body.read.availability, queries: body.read.queries, returned: body.read.returned });
}

assert.equal(
  await availability(deps({ workspace: visibleFlags, client: hiddenFlags }, { lastSyncedAt: '2026-10-16T12:00:00.000Z', queries: [query] })),
  JSON.stringify({ availability: 'hidden_by_capability', queries: [], returned: 0 }),
);
assert.equal(
  await availability(deps({ workspace: visibleFlags, client: visibleFlags }, { lastSyncedAt: null, queries: [] })),
  JSON.stringify({ availability: 'never_synced', queries: [], returned: 0 }),
);
assert.equal(
  await availability(deps({ workspace: visibleFlags, client: visibleFlags }, { lastSyncedAt: null, queries: [] }, null)),
  JSON.stringify({ availability: 'never_synced', queries: [], returned: 0 }),
);
assert.equal(
  await availability(deps({ workspace: visibleFlags, client: visibleFlags }, { lastSyncedAt: '2026-10-16T12:00:00.000Z', queries: [] })),
  JSON.stringify({ availability: 'ready', queries: [], returned: 0 }),
);
assert.equal(
  await availability(deps({ workspace: visibleFlags, client: visibleFlags }, { lastSyncedAt: null, queries: [query] })),
  JSON.stringify({ availability: 'ready', queries: [query], returned: 1 }),
);

const leaked = projectMcpBrainRead(
  { tool: 'get_gsc_performance', clientId: CLIENT, limit: 10, ...DATES, view: 'queries' },
  {
    clientId: CLIENT,
    storeId: STORE,
    lastSyncedAt: null,
    sourceSystem: 'brain',
    availability: 'hidden_by_capability',
    limit: 10,
    queries: [query],
    pages: [],
  },
);
assert.ok(leaked);
assert.equal(leaked.availability, 'hidden_by_capability');
assert.deepEqual(leaked.queries, []);
assert.equal(JSON.stringify(leaked).includes('heat pump'), false);

assert.equal(projectMcpBrainRead(
  { tool: 'get_store_catalog', clientId: CLIENT, limit: 1 },
  {
    clientId: CLIENT,
    storeId: STORE,
    lastSyncedAt: null,
    sourceSystem: 'brain',
    availability: 'never_synced',
    limit: 1,
    products: [],
    collections: [],
  },
), null);
assert.equal(projectMcpBrainRead(
  { tool: 'get_gsc_performance', clientId: CLIENT, limit: 1, ...DATES, view: 'queries' },
  {
    clientId: CLIENT,
    storeId: STORE,
    lastSyncedAt: null,
    sourceSystem: 'stub',
    availability: 'not_synced',
    limit: 1,
    queries: [],
    pages: [],
  },
), null);

console.log('mcp-gsc-availability: ok');
