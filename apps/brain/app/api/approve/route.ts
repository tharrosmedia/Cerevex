import { inngest } from '../../../src/inngest/client';

export async function POST(request: Request) {
  const body = await request.json();
  console.log('[INNGEST] sending approval/decided via api', { jobId: body?.jobId });
  try {
    await inngest.send({ name: 'approval/decided', data: body });
    console.log('[INNGEST] approval api send completed');
  } catch (e: any) {
    console.error('Failed to send approval via api', e);
  }
  return Response.json({ received: true });
}
