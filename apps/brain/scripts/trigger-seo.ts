import 'dotenv/config';
import { inngest } from '../src/inngest/client.js';

const args = process.argv.slice(2);
const storeArgIdx = args.indexOf('--store');
const storeId = (storeArgIdx !== -1 ? args[storeArgIdx + 1] : process.env.DEV_STORE_ID) as string;
if (!storeId) {
  console.error('Usage: tsx scripts/trigger-seo.ts [--store <storeId>] (or set DEV_STORE_ID)');
  process.exit(1);
}
await inngest.send({
  name: 'seo/job.requested',
  data: {
    storeId,
    keyword: 'daikin single zone mini split',
    type: 'collection',
    brandVoice: { text: 'Professional, helpful, benefit-focused for HVAC.' },
  },
});
console.log('Triggered for keyword daikin single zone mini split (type: collection)');
