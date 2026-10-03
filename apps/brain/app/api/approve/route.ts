import { inngest } from '../../../src/inngest/client';
import { authorizeApproveSession, credentialsFrom, gateJson } from '@/lib/sensitive-auth';

type ApproveDeps = {
  send: (data: unknown) => Promise<unknown>;
};

async function defaultSend(data: unknown) {
  await inngest.send({ name: 'approval/decided', data });
}

export async function postApprove(request: Request, deps?: ApproveDeps) {
  const gate = authorizeApproveSession(credentialsFrom({ headers: request.headers, url: request.url }));
  if (!gate.ok) return gateJson(gate);
  const body = await request.json().catch(() => ({}));
  console.log('[INNGEST] sending approval/decided via api', { jobId: (body as { jobId?: string })?.jobId });
  try {
    await (deps?.send ?? defaultSend)(body);
    console.log('[INNGEST] approval api send completed');
  } catch (e: any) {
    console.error('Failed to send approval via api', e);
    return Response.json({ received: false, error: 'send failed' }, { status: 502 });
  }
  return Response.json({ received: true });
}

export async function POST(request: Request) {
  return postApprove(request);
}
