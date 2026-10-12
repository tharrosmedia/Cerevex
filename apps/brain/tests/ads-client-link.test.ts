import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptedClientSentence, syncAdsClientOnRename } from '../lib/ads-client-link';
import type { AdsClient, AdsResult } from '../lib/ads-bff';

const here = dirname(fileURLToPath(import.meta.url));

function client(partial: Pick<AdsClient, 'id' | 'name' | 'siteId'>): AdsClient {
  return {
    id: partial.id,
    workspaceId: 'ws',
    name: partial.name,
    siteId: partial.siteId,
  };
}

function listed(rows: AdsClient[]): AdsResult<{ clients: AdsClient[] }> {
  return { ok: true, data: { clients: rows }, status: 200 };
}

function denied(message: string, status = 409): AdsResult<{ client: AdsClient }> {
  return { ok: false, reason: 'error', message, status };
}

const calls: string[] = [];

assert.equal(
  adoptedClientSentence('HVAC USA'),
  "There's already a client called HVAC USA. Linked that one.",
);

const unchanged = await syncAdsClientOnRename(
  { siteId: 'site-1', previousName: 'HVAC USA', nextName: 'HVAC USA' },
  {
    listClients: async () => {
      calls.push('list');
      return listed([]);
    },
  },
);
assert.deepEqual(unchanged, { ok: true });
assert.equal(calls.length, 0);

const created = await syncAdsClientOnRename(
  { siteId: 'site-1', previousName: 'My site', nextName: 'HVAC USA' },
  {
    listClients: async () => listed([]),
    ensure: async (siteId, name) => {
      calls.push(`ensure:${siteId}:${name}`);
      return { ok: true, data: { client: client({ id: 'c-new', name, siteId }), created: true, adopted: false }, status: 200 };
    },
    rename: async () => {
      throw new Error('rename must not run when the site has no ads client');
    },
  },
);
assert.deepEqual(created, { ok: true });
assert.deepEqual(calls.slice(), ['ensure:site-1:HVAC USA']);

calls.length = 0;
const adopted = await syncAdsClientOnRename(
  { siteId: 'site-1', previousName: 'My site', nextName: 'KC Prestige HVAC' },
  {
    listClients: async () => listed([]),
    ensure: async (siteId, name) => {
      calls.push(`ensure:${siteId}:${name}`);
      return {
        ok: true,
        data: { client: client({ id: 'c-existing', name: 'KC Prestige HVAC', siteId }), created: false, adopted: true },
        status: 200,
      };
    },
  },
);
assert.equal(adopted.ok, true);
assert.deepEqual(calls.slice(), ['ensure:site-1:KC Prestige HVAC']);

calls.length = 0;
const renamed = await syncAdsClientOnRename(
  { siteId: 'site-1', previousName: 'HVAC USA', nextName: 'HVAC USA North' },
  {
    listClients: async () => listed([client({ id: 'c1', name: 'HVAC USA', siteId: 'site-1' })]),
    rename: async (clientId, name) => {
      calls.push(`rename:${clientId}:${name}`);
      return { ok: true, data: { client: client({ id: clientId, name, siteId: 'site-1' }) }, status: 200 };
    },
    ensure: async () => {
      throw new Error('create must not run when the site already has an ads client');
    },
  },
);
assert.deepEqual(renamed, { ok: true });
assert.deepEqual(calls.slice(), ['rename:c1:HVAC USA North']);

const taken = "There's already a client called HVAC USA.";
const blocked = await syncAdsClientOnRename(
  { siteId: 'site-1', previousName: 'KC Prestige HVAC', nextName: 'HVAC USA' },
  {
    listClients: async () => listed([client({ id: 'c1', name: 'KC Prestige HVAC', siteId: 'site-1' })]),
    rename: async () => denied(taken),
    ensure: async () => {
      throw new Error('a refused rename must not create a second client');
    },
  },
);
assert.deepEqual(blocked, { ok: false, message: taken });

const blank = await syncAdsClientOnRename({ siteId: 'site-1', previousName: 'HVAC USA', nextName: '   ' });
assert.deepEqual(blank, { ok: false, message: 'Enter a name.' });

const many = await syncAdsClientOnRename(
  { siteId: 'site-1', previousName: 'HVAC USA', nextName: 'Other' },
  {
    listClients: async () => listed([
      client({ id: 'c1', name: 'HVAC USA', siteId: 'site-1' }),
      client({ id: 'c2', name: 'Other', siteId: 'site-1' }),
    ]),
  },
);
assert.equal(many.ok, false);

const storesPage = readFileSync(join(here, '../app/stores/page.tsx'), 'utf8');
const shopify = storesPage.slice(
  storesPage.indexOf('async function addShopifyStore'),
  storesPage.indexOf('async function addWordpressSite'),
);
assert.ok(shopify.indexOf('createStore') < shopify.indexOf('nameAndLinkSiteClient'));
assert.match(shopify, /nameAndLinkSiteClient\(store\.id, store\.name\)/);
assert.match(shopify, /config: emptyClientWorkspaceConfig\(\)/);
const wordpress = storesPage.slice(
  storesPage.indexOf('async function addWordpressSite'),
  storesPage.indexOf('async function testConnection'),
);
assert.match(wordpress, /nameAndLinkSiteClient\(created\.id, created\.name\)/);
assert.match(storesPage, /adoptedClientSentence\(params\.client\)/);

const editPage = readFileSync(join(here, '../app/stores/[id]/edit/page.tsx'), 'utf8');
const updateFn = editPage.slice(editPage.indexOf('async function update'), editPage.indexOf('export default'));
assert.ok(updateFn.indexOf('syncAdsClientOnRename') < updateFn.indexOf('await updateStore'));
assert.match(updateFn, /if \(!synced\.ok\) redirect\(editUrl\(id, synced\.message\)\)/);

const bff = readFileSync(join(here, '../lib/ads-bff.ts'), 'utf8');
const ensureFn = bff.slice(bff.indexOf('export function ensureSiteClient'), bff.indexOf('export function listAdsClients'));
const renameFn = bff.slice(bff.indexOf('export function renameAdsClient'), bff.indexOf('export function linkAdsClientSite'));
const linkFn = bff.slice(bff.indexOf('export function linkAdsClientSite'), bff.indexOf('export function connectedPlatforms'));
assert.match(ensureFn, /method: "PUT"/);
assert.match(ensureFn, /asOwner: true/);
assert.match(renameFn, /method: "PATCH"/);
assert.match(renameFn, /asOwner: true/);
assert.match(linkFn, /method: "POST"/);
assert.match(linkFn, /asOwner: true/);

const links = readFileSync(join(here, '../components/ads-site-links.tsx'), 'utf8');
assert.match(links, /linkAdsClientSite\(clientId, siteId\)/);
assert.equal(links.includes("method: 'POST'"), false);

const sites = readFileSync(join(here, '../../ads/api/src/sites.ts'), 'utf8');
assert.match(sites, /app\.patch\("\/clients\/:id"/);
assert.equal(sites.includes('app.delete'), false);
assert.match(sites, /client\.renamed/);
assert.match(sites, /refuseServiceKey/);

console.log('ads-client-link: ok');
