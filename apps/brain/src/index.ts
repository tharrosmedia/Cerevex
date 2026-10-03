import 'dotenv/config';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serve as inngestServe } from 'inngest/hono';
import { authorizeApprover, credentialsFrom } from '../lib/sensitive-auth';
import { inngest } from './inngest/client';
import { functions } from './inngest/index';

const app = new Hono();

app.get('/', (c) => c.text('Cerevex'));

const inngestHandler = inngestServe({ client: inngest, functions });
app.get('/api/inngest', inngestHandler);
app.post('/api/inngest', inngestHandler);
app.put('/api/inngest', inngestHandler);

app.post('/api/approve', async (c) => {
  const gate = authorizeApprover(credentialsFrom({ headers: c.req.raw.headers, url: c.req.url }));
  if (!gate.ok) return c.json({ error: gate.error }, gate.status);
  const body = await c.req.json();
  console.log('[INNGEST] sending approval/decided via hono', { jobId: body?.jobId });
  try {
    await inngest.send({ name: 'approval/decided', data: body });
    console.log('[INNGEST] approval hono send completed');
  } catch (e: any) {
    console.error('Failed to send approval via hono', e);
    return c.json({ received: false, error: 'send failed' }, 502);
  }
  return c.json({ received: true });
});

const port = Number(process.env.PORT || 3000);
console.log('Server on port ' + port);
serve({ fetch: app.fetch, port });
