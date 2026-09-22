import 'dotenv/config';

const apiKey = process.env.INNGEST_API_KEY;
const appId = process.env.INNGEST_APP_ID || 'shopify-brain';
const base = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const handlerUrl = base ? `${base}/api/inngest` : 'https://your-domain.example/api/inngest';

if (!apiKey) {
  console.error('INNGEST_API_KEY is required (create a management key in Inngest dashboard)');
  process.exit(1);
}
if (!process.env.PUBLIC_URL) {
  console.error('PUBLIC_URL is required (base domain, e.g. https://cerevex.store)');
  process.exit(1);
}

console.log('[INNGEST] syncing app', appId, 'to', handlerUrl);

const res = await fetch(`https://api.inngest.com/v2/apps/${appId}/syncs`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: handlerUrl }),
});

const text = await res.text();
console.log('Status:', res.status);
console.log('Response:', text);

if (!res.ok) {
  console.error('Sync failed');
  process.exit(1);
}

console.log('Sync completed successfully');
