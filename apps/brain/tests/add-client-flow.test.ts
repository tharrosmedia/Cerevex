import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddClientFlow } from '../components/add-client-flow';
import { WordpressAddSiteDownload } from '../components/wordpress-add-site-download';
import { WORDPRESS_CONNECT_OFF_REASON } from '../src/lib/wordpress/connect-copy';
import {
  ADD_STORE_CONNECT_LATER,
  MAKE_NEW_CLIENT,
  PASTE_ADMIN_TOKEN,
  PICK_BUSINESS_TYPE,
  SKILLS_PROFILE_FOUND,
  WORDPRESS_UNREACHABLE,
  alreadyClientUse,
  siteAlreadyLinked,
  storeAddressTaken,
} from '../lib/ui-copy';
import {
  addClientHref,
  decideClientIdentity,
  planShopifyAdd,
  planWordpressAdd,
  profileFoundForName,
  shopifyAddConfig,
  skillProfileSuggestions,
  wordpressConnectFailureMessage,
} from '../lib/add-client-flow';

const here = dirname(fileURLToPath(import.meta.url));
const completedAt = '2026-10-15T16:00:00.000Z';

const suggestions = skillProfileSuggestions({
  stores: [{ name: 'KC Prestige' }],
  clients: [
    { name: 'HVAC USA', siteId: 'site-hvac' },
    { name: 'Elmar HVAC', siteId: null },
  ],
});
assert.equal(suggestions.includes('HVAC USA'), false);
assert.equal(suggestions.includes('KC Prestige HVAC'), false);
assert.equal(suggestions.includes('Elmar HVAC'), true);
assert.equal(suggestions.includes('Got Ductless'), true);
assert.equal(profileFoundForName('Elmar HVAC', suggestions), true);
assert.equal(profileFoundForName('KC Prestige', suggestions), false);

const prompted = decideClientIdentity({
  name: 'kc prestige',
  businessType: 'home_service',
  choice: 'continue',
  clients: [{ name: 'KC Prestige', siteId: null }],
});
assert.equal(prompted.ok, false);
if (!prompted.ok) {
  assert.equal(prompted.code, 'choose-existing');
  assert.equal(prompted.message, alreadyClientUse('KC Prestige'));
}
const adopted = decideClientIdentity({
  name: 'kc prestige',
  businessType: 'home_service',
  choice: 'use',
  clients: [{ name: 'KC Prestige', siteId: null }],
});
assert.equal(adopted.ok, true);
if (adopted.ok) {
  assert.equal(adopted.name, 'KC Prestige');
  assert.equal(adopted.adopt, true);
}
const makeNew = decideClientIdentity({
  name: 'KC Prestige',
  businessType: 'home_service',
  choice: 'new',
  clients: [{ name: 'KC Prestige', siteId: null }],
});
assert.equal(makeNew.ok, false);
if (!makeNew.ok) assert.equal(makeNew.code, 'type-new');

const linkedName = decideClientIdentity({
  name: 'HVAC USA',
  businessType: 'ecommerce',
  choice: 'continue',
  clients: [{ name: 'HVAC USA', siteId: 'site-hvac' }],
});
assert.equal(linkedName.ok, false);
if (!linkedName.ok) assert.equal(linkedName.message, "There's already a client called HVAC USA.");

const agency = decideClientIdentity({
  name: 'Elmar HVAC',
  businessType: 'agency',
  choice: 'continue',
  clients: [],
});
assert.equal(agency.ok, false);
if (!agency.ok) assert.equal(agency.message, PICK_BUSINESS_TYPE);

const duplicate = planShopifyAdd({
  name: 'New store',
  businessType: 'ecommerce',
  domain: 'HTTPS://HVAC.myshopify.com/admin',
  token: '',
  connect: 'later',
  stores: [{ name: 'HVAC USA', shopify_domain: 'hvac.myshopify.com' }],
  completedAt,
});
assert.equal(duplicate.ok, false);
if (!duplicate.ok) assert.equal(duplicate.message, storeAddressTaken('HVAC USA'));

const later = planShopifyAdd({
  name: '  HVAC USA  ',
  businessType: 'home_service',
  domain: 'hvac-usa',
  token: '   ',
  connect: 'later',
  stores: [],
  completedAt,
});
assert.equal(later.ok, true);
if (later.ok) {
  assert.equal(later.mode, 'later');
  assert.equal(later.name, 'HVAC USA');
  assert.equal(later.domain, 'hvac-usa.myshopify.com');
  assert.equal(later.token, null);
  assert.equal(later.config.shopify?.status, 'not_connected');
  assert.equal(later.config.workspace.businessType, 'home_service');
  assert.equal(JSON.stringify(later.config).includes('shpat_'), false);
}

const pasted = planShopifyAdd({
  name: 'HVAC USA',
  businessType: 'ecommerce',
  domain: 'hvac-usa.myshopify.com',
  token: 'shpat_fixture',
  connect: 'paste',
  stores: [],
  completedAt,
});
assert.equal(pasted.ok, true);
if (pasted.ok) {
  assert.equal(pasted.mode, 'paste');
  assert.equal(pasted.token, 'shpat_fixture');
  assert.equal(pasted.config.shopify, undefined);
  assert.equal(JSON.stringify(pasted.config).includes('shpat_fixture'), false);
}

const emptyWorkspace = shopifyAddConfig({ businessType: 'ecommerce', connectLater: false, completedAt });
assert.equal(emptyWorkspace.workspace.businessType, 'ecommerce');
assert.equal(Object.prototype.hasOwnProperty.call(emptyWorkspace.workspace, 'fromCookie'), false);

const sameSite = planWordpressAdd({
  siteUrl: 'HTTPS://KC.Example/',
  stores: [{
    name: 'KC Prestige',
    shopify_domain: 'https://kc.example',
    platform: 'wordpress',
    connector_type: 'wordpress',
  }],
});
assert.equal(sameSite.ok, false);
if (!sameSite.ok) assert.equal(sameSite.message, siteAlreadyLinked('KC Prestige'));

const freshSite = planWordpressAdd({
  siteUrl: 'https://elmar.example',
  stores: [{
    name: 'KC Prestige',
    shopify_domain: 'https://kc.example',
    platform: 'wordpress',
    connector_type: 'wordpress',
  }],
});
assert.equal(freshSite.ok, true);
assert.equal(
  wordpressConnectFailureMessage({ code: 'unreachable', reason: "Couldn't reach the site." }),
  WORDPRESS_UNREACHABLE,
);
assert.equal(wordpressConnectFailureMessage({ code: 'plugin_down' }), WORDPRESS_UNREACHABLE);

const href = addClientHref({ step: 'who', name: 'Elmar HVAC', business: 'home_service' });
assert.match(href, /^\/stores\?/);
assert.equal(href.includes('pluginKey'), false);
assert.equal(href.includes('shpat_'), false);

function render(props: Partial<Parameters<typeof AddClientFlow>[0]> = {}) {
  return renderToStaticMarkup(createElement(AddClientFlow, {
    step: 'who',
    name: '',
    businessType: '',
    suggestions,
    existingClientName: null,
    platform: null,
    message: null,
    identityAction: async () => {},
    shopifyAction: async () => {},
    wordpress: null,
    ...props,
  }));
}

const who = render({ name: 'Elmar HVAC', businessType: 'home_service' });
assert.equal(who.match(/class="btn-cta"/g)?.length, 1);
assert.match(who, new RegExp(SKILLS_PROFILE_FOUND));
assert.equal(who.includes('Agency'), false);
assert.equal(who.includes('agency'), false);
assert.match(who, /Home-service business/);
assert.match(who, /Online store/);
assert.match(who, /Elmar HVAC/);
assert.equal(who.includes('HVAC USA'), false);
assert.equal(who.includes('nowrap'), false);

const prompt = render({ name: 'KC Prestige', existingClientName: 'KC Prestige', businessType: 'home_service' });
assert.equal(prompt.match(/class="btn-cta"/g)?.length, 1);
assert.match(prompt, /Use KC Prestige/);
assert.match(prompt, new RegExp(MAKE_NEW_CLIENT));
assert.equal(prompt.includes('btn-cta">Make a new client'), false);

const shopify = render({
  step: 'site',
  name: 'HVAC USA',
  businessType: 'ecommerce',
  suggestions: [],
  platform: 'shopify',
});
assert.equal(shopify.match(/class="btn-cta"/g)?.length, 1);
assert.match(shopify, new RegExp(ADD_STORE_CONNECT_LATER));
const details = shopify.slice(shopify.indexOf('<details'), shopify.indexOf('</details>'));
assert.match(details, /shopify_access_token/);
assert.equal(details.includes(PASTE_ADMIN_TOKEN), true);
assert.equal(details.includes('btn-cta'), false);
assert.equal(shopify.includes('Agency'), false);

const wordpressOff = render({
  step: 'site',
  name: 'KC Prestige HVAC',
  businessType: 'home_service',
  suggestions: [],
  platform: 'wordpress',
  wordpress: createElement(WordpressAddSiteDownload, { visible: false }),
});
const wordpressText = wordpressOff.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
assert.equal(wordpressText.includes(WORDPRESS_CONNECT_OFF_REASON), true);
assert.equal(wordpressOff.includes('In-app download'), false);
assert.equal(wordpressOff.includes('/api/wordpress/plugin'), false);
assert.equal(wordpressOff.match(/class="btn-cta"/g), null);

const page = readFileSync(join(here, '../app/stores/page.tsx'), 'utf8');
const shopifyFn = page.slice(page.indexOf('async function addShopifyStore'), page.indexOf('async function addWordpressSite'));
const laterBranch = shopifyFn.slice(0, shopifyFn.indexOf('verifyShopifyConnection'));
assert.equal(laterBranch.includes('syncProductsForStore'), false);
assert.match(laterBranch, /shopify_access_token: null/);
assert.match(laterBranch, /setupHref\(/);
const pasteBranch = shopifyFn.slice(shopifyFn.indexOf('verifyShopifyConnection'));
assert.ok(pasteBranch.indexOf('syncProductsForStore') > 0);
assert.match(pasteBranch, /seo\/catalog\.sync\.requested/);
assert.match(page, /hasShopifyAccessToken\(store\)/);
assert.match(page, /<WordpressAddSiteDownload visible \/>/);
assert.match(page, /<WordpressAddSiteDownload visible=\{false\} \/>/);

const storesSrc = readFileSync(join(here, '../src/lib/db/stores.ts'), 'utf8');
const createFn = storesSrc.slice(storesSrc.indexOf('export async function createStore'), storesSrc.indexOf('export async function updateStore'));
assert.match(createFn, /shopify_access_token == null/);

const css = readFileSync(join(here, '../app/globals.css'), 'utf8');
assert.match(css, /\.cx-add-client \{[^}]*max-width: 100%/);
assert.match(css, /\.cx-add-client \{[^}]*min-width: 0/);
assert.match(css, /\.cx-add-client \{[^}]*overflow-wrap: anywhere/);
assert.match(css, /\.cx-add-client \.btn-cta[^}]*white-space: normal/);

assert.equal(who.includes('white-space:nowrap'), false);
assert.equal(shopify.includes('width="'), false);

console.log('add-client-flow: ok');
