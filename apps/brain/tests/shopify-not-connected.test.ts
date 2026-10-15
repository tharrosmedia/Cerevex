import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishContent } from '../src/lib/agents/seo/publisher';
import {
  SHOPIFY_NOT_CONNECTED,
  SHOPIFY_NOT_CONNECTED_MESSAGE,
  shopifyNotConnectedSkip,
} from '../src/lib/shopify/not-connected';
import { syncCatalogForStore, syncProductsForStore } from '../src/lib/shopify/sync';
import { runCatalogSync } from '../../../jobs/seo/src/functions/catalog-sync';

const here = dirname(fileURLToPath(import.meta.url));
const skip = shopifyNotConnectedSkip();
const disconnected = {
  id: 'store-1',
  platform: 'shopify',
  connector_type: 'shopify',
  shopify_domain: 'pending.myshopify.com',
  shopify_access_token: null,
};

function refuseShopify(): never {
  throw new Error('Shopify was called');
}

{
  let opened = false;
  const products = await syncProductsForStore('store-1', {
    getStore: async () => disconnected,
    createAdminClient: () => {
      opened = true;
      return refuseShopify();
    },
  });
  assert.equal(opened, false);
  assert.deepEqual(products, { synced: 0, totalFetched: 0, ...skip });
}

{
  let opened = false;
  const catalog = await syncCatalogForStore('store-1', {
    getStore: async () => ({ ...disconnected, shopify_access_token: '   ' }),
    createAdminClient: () => {
      opened = true;
      return refuseShopify();
    },
  });
  assert.equal(opened, false);
  assert.equal(catalog.skipped, SHOPIFY_NOT_CONNECTED);
  assert.equal(catalog.message, SHOPIFY_NOT_CONNECTED_MESSAGE);
  assert.deepEqual(catalog.counts, { collection: 0, page: 0, article: 0 });
  assert.deepEqual(catalog.errors, []);
}

{
  let opened = false;
  const published = await publishContent({
    storeId: 'store-1',
    draft: { title: 'Filters' },
    loadStore: async () => null,
    createClient: () => {
      opened = true;
      return refuseShopify();
    },
  });
  assert.equal(opened, false);
  assert.deepEqual(published, skip);
}

{
  const events: Array<{ action: string; payload: Record<string, unknown> }> = [];
  let recorded = false;
  const result = await runCatalogSync('store-1', {
    syncCatalogForStore: async () => ({
      synced: 0,
      totalFetched: 0,
      counts: { collection: 0, page: 0, article: 0 },
      errors: [],
      ...skip,
    }),
    recordCatalogSync: async () => {
      recorded = true;
    },
    logEvent: async (_storeId, _actor, action, payload = {}) => {
      events.push({ action, payload });
    },
  });
  assert.equal(recorded, false);
  assert.deepEqual(result, {
    synced: 0,
    totalFetched: 0,
    counts: { collection: 0, page: 0, article: 0 },
    errors: [],
    ...skip,
  });
  assert.deepEqual(events, [{
    action: 'catalog.skipped',
    payload: { skipped: SHOPIFY_NOT_CONNECTED, message: SHOPIFY_NOT_CONNECTED_MESSAGE },
  }]);
}

{
  const wordpress = await syncProductsForStore('wp-1', {
    getStore: async () => ({
      platform: 'wordpress',
      connector_type: 'wordpress',
      shopify_access_token: '',
      shopify_domain: 'kc.example',
    }),
    createAdminClient: () => refuseShopify(),
  });
  assert.deepEqual(wordpress, { synced: 0, totalFetched: 0, skipped: 'wordpress' });
}

{
  let recorded = false;
  const result = await runCatalogSync('store-1', {
    syncCatalogForStore: async () => ({
      synced: 0,
      totalFetched: 0,
      counts: { collection: 0, page: 0, article: 0 },
      errors: [],
      ...skip,
    }),
    recordCatalogSync: async () => {
      recorded = true;
    },
    logEvent: async () => {
      throw new Error('database unavailable');
    },
  });
  assert.equal(recorded, false);
  assert.equal(result.skipped, SHOPIFY_NOT_CONNECTED);
  assert.equal(result.message, SHOPIFY_NOT_CONNECTED_MESSAGE);
}

{
  let fetched = false;
  const products = await syncProductsForStore('store-1', {
    getStore: async () => ({
      platform: 'shopify',
      shopify_domain: 'gd.myshopify.com',
      shopify_access_token: 'shpat_test',
    }),
    createAdminClient: () => ({ id: 'client' }),
    fetchProducts: async () => {
      fetched = true;
      return [{ title: 'Filter', handle: 'filter', descriptionHtml: 'Air filters', shopifyId: 'gid://1' }];
    },
    upsertProduct: async () => ({}),
    writeKnowledge: async () => {},
  });
  assert.equal(fetched, true);
  assert.equal(products.skipped, undefined);
  assert.equal(products.synced, 1);
  assert.equal(products.totalFetched, 1);
}

{
  let domain = '';
  await assert.rejects(
    () => publishContent({
      storeId: 'store-1',
      draft: { title: 'Filters' },
      preloaded: { domain: 'preload.myshopify.com', accessToken: '  ' },
      loadStore: async () => ({
        platform: 'shopify',
        shopify_domain: 'gd.myshopify.com',
        shopify_access_token: 'shpat_test',
      }),
      createClient: (shop: string) => {
        domain = shop;
        throw new Error('shopify-client-opened');
      },
    }),
    /shopify-client-opened/,
  );
  assert.equal(domain, 'gd.myshopify.com');
}

const storesPage = readFileSync(join(here, '../app/stores/page.tsx'), 'utf8');
const testConnection = storesPage.slice(
  storesPage.indexOf('async function testConnection'),
  storesPage.indexOf('async function selectStore'),
);
assert.match(testConnection, /SHOPIFY_NOT_CONNECTED_MESSAGE/);
assert.equal(testConnection.includes('has no access token'), false);

const job = readFileSync(join(here, '../../../jobs/seo/src/functions/job.ts'), 'utf8');
const skipReturn = job.indexOf("status: 'skipped'");
const sentryPublish = job.indexOf("step: 'publish'");
assert.ok(skipReturn > 0 && sentryPublish > skipReturn);

const gscApply = readFileSync(join(here, '../../../jobs/seo/src/functions/gsc-apply.ts'), 'utf8');
const gscSkip = gscApply.indexOf('isShopifyNotConnectedSkip(result)');
const gscSucceeded = gscApply.indexOf('gsc.apply.succeeded');
assert.ok(gscSkip > 0 && gscSkip < gscSucceeded);
assert.match(gscApply.slice(gscSkip, gscSucceeded), /writes: false/);

const live = readFileSync(join(here, '../app/seo/live/page.tsx'), 'utf8');
const syncNow = live.slice(live.indexOf('async function syncNow'), live.indexOf('export const dynamic'));
assert.ok(syncNow.indexOf('SHOPIFY_NOT_CONNECTED') < syncNow.indexOf('recordCatalogSync'));

console.log('shopify-not-connected: ok');
