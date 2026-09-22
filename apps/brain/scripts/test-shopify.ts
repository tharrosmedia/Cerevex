import 'dotenv/config';
import { createAdminClient } from '../src/lib/shopify/client.js';
import { createAndPublishCollection } from '../src/lib/shopify/collections.js';

const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const token = process.env.SHOPIFY_ACCESS_TOKEN!;
if (!domain || !token) {
  throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN in .env');
}
const client = createAdminClient(domain, token);
const result = await createAndPublishCollection(client, {
  title: 'Test Shopify Brain ' + new Date().toISOString(),
  bodyHtml: '<p>Created by Shopify Brain test script. Safe to delete.</p>'
});
console.dir(result, { depth: 3 });
