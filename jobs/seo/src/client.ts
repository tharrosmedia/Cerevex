import { Inngest } from 'inngest';

console.log('[INNGEST] client init', { eventKey: !!process.env.INNGEST_EVENT_KEY, signingKey: !!process.env.INNGEST_SIGNING_KEY });

export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID || 'shopify-brain',
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
