import 'dotenv/config';
import { getStore } from '../src/lib/db/stores';
import { createAdminClient } from '../src/lib/shopify/client';
import { fetchStoreSamples } from '../src/lib/shopify/content';
import { writeKnowledge } from '../src/lib/brain/memory';

const args = process.argv.slice(2);
const storeArgIdx = args.indexOf('--store');
const storeId = (storeArgIdx !== -1 ? args[storeArgIdx + 1] : process.env.DEV_STORE_ID) as string;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 5;

if (!storeId) {
  console.error('Usage: tsx scripts/ingest-knowledge.ts --store <storeId> [--limit N]');
  process.exit(1);
}

async function run() {
  const store = await getStore(storeId);
  if (!store || !store.shopify_access_token) {
    console.error('Store not found or missing token for', storeId);
    process.exit(1);
  }
  const client = createAdminClient(store.shopify_domain, store.shopify_access_token);
  console.log('Fetching samples for', store.name || storeId);
  const samples = await fetchStoreSamples(client, limit);
  let written = 0;
  for (const s of samples) {
    try {
      await writeKnowledge(storeId, `${s.title}: ${s.body}`, {
        type: 'shopify_sample',
        title: s.title,
        source: 'shopify',
      });
      written++;
    } catch (e) {
      console.warn('Failed to write sample', s.title, e);
    }
  }
  // Also ingest existing brand voice if present
  const bv = store.config?.brandVoice?.text;
  if (bv) {
    try {
      await writeKnowledge(storeId, bv, { type: 'brand_voice', source: 'manual_ingest' });
      written++;
    } catch (e) {
      console.warn('Failed to write brand voice', e);
    }
  }
  console.log(`Ingested ${written} knowledge items (from ${samples.length} samples)`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
