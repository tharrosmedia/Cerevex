import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serve as inngestServe } from 'inngest/hono';
import { inngest } from './inngest/client';
import { functions } from './inngest/index';

const app = new Hono();

app.get('/', (c) => c.text('Shopify Brain'));

const inngestHandler = inngestServe({ client: inngest, functions });
app.get('/api/inngest', inngestHandler);
app.post('/api/inngest', inngestHandler);
app.put('/api/inngest', inngestHandler);

app.post('/api/approve', async (c) => {
  const body = await c.req.json();
  console.log('[INNGEST] sending approval/decided via hono', { jobId: body?.jobId });
  try {
    await inngest.send({ name: 'approval/decided', data: body });
    console.log('[INNGEST] approval hono send completed');
  } catch (e: any) {
    console.error('Failed to send approval via hono', e);
  }
  return c.json({ received: true });
});

const port = Number(process.env.PORT || 3000);
console.log('Server on port ' + port);
serve({ fetch: app.fetch, port });
