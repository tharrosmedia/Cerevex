import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHOPIFY_API_VERSION_DEFAULT, shopifyApiVersion } from '../src/lib/shopify/api-version';

assert.equal(SHOPIFY_API_VERSION_DEFAULT, '2026-10');
assert.equal(shopifyApiVersion({} as NodeJS.ProcessEnv), '2026-10');
assert.equal(shopifyApiVersion({ SHOPIFY_API_VERSION: '2026-07' }), '2026-07');
assert.equal(shopifyApiVersion({ SHOPIFY_API_VERSION: '  unstable  ' }), 'unstable');
assert.equal(shopifyApiVersion({ SHOPIFY_API_VERSION: 'not-a-version' }), '2026-10');
assert.equal(shopifyApiVersion({ SHOPIFY_API_VERSION: '' }), '2026-10');

const client = readFileSync(new URL('../src/lib/shopify/client.ts', import.meta.url), 'utf8');
assert.equal(client.includes('shopifyApiVersion'), true);
assert.equal(client.includes('July25'), false);
assert.equal(client.includes('2025-07'), false);
