import assert from 'node:assert/strict';
import { clearPublicationCache, getOnlineStorePublicationId } from '../src/lib/shopify/publications';

function clientFor(shop: string, publicationId: string) {
  let calls = 0;
  return {
    calls: () => calls,
    session: { shop },
    async request(query: string) {
      calls += 1;
      assert.match(query, /publications/);
      return {
        data: {
          publications: {
            edges: [{ node: { id: publicationId, name: 'Online Store' } }],
          },
        },
      };
    },
  };
}

clearPublicationCache();
const storeA = 'store-a';
const storeB = 'store-b';
const clientA = clientFor('alpha.myshopify.com', 'gid://shopify/Publication/A');
const clientB = clientFor('beta.myshopify.com', 'gid://shopify/Publication/B');

const firstA = await getOnlineStorePublicationId(clientA, storeA);
const firstB = await getOnlineStorePublicationId(clientB, storeB);
const secondA = await getOnlineStorePublicationId(clientA, storeA);

assert.equal(firstA, 'gid://shopify/Publication/A');
assert.equal(firstB, 'gid://shopify/Publication/B');
assert.notEqual(firstA, firstB);
assert.equal(secondA, firstA);
assert.equal(clientA.calls(), 1);
assert.equal(clientB.calls(), 1);

const againByShop = await getOnlineStorePublicationId(clientA);
assert.equal(againByShop, 'gid://shopify/Publication/A');
assert.equal(clientA.calls(), 2);
const cachedShop = await getOnlineStorePublicationId(clientA);
assert.equal(cachedShop, againByShop);
assert.equal(clientA.calls(), 2);
assert.equal(clientB.calls(), 1);

clearPublicationCache();
console.log('publications-cache: ok');
