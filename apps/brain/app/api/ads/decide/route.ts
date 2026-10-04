import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';
import { authorizeApprover, credentialsFrom, gateJson } from '@/lib/sensitive-auth';

export const dynamic = 'force-dynamic';

type DecideBody = {
  recommendationId?: string;
  action?: string;
  note?: string;
};

type Forward = (body: DecideBody) => Promise<Response>;

async function defaultForward(body: DecideBody): Promise<Response> {
  const result = await adsApi<{
    recommendation: unknown;
    applyJob?: unknown;
    note?: string;
    error?: string;
  }>(`/recommendations/${body.recommendationId}/decide`, {
    method: 'POST',
    body: JSON.stringify({ action: body.action, note: body.note }),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status || 502 });
  }
  return NextResponse.json(result.data, { status: result.status });
}

export async function postDecide(request: Request, forward: Forward = defaultForward): Promise<Response> {
  const body = (await request.json().catch(() => null)) as DecideBody | null;
  if (!body?.recommendationId || !body.action) {
    return NextResponse.json({ error: 'recommendationId and action are required' }, { status: 400 });
  }
  if (!['approve', 'authorize', 'deny', 'snooze', 'mark_done', 'rollback'].includes(body.action)) {
    return NextResponse.json({ error: 'action must be approve, deny, snooze, mark_done, or rollback' }, { status: 400 });
  }
  const creds = credentialsFrom({ headers: request.headers, url: request.url });
  const gate = authorizeApprover(creds);
  if (!gate.ok) return gateJson(gate);
  return forward(body);
}

export async function POST(request: Request) {
  return postDecide(request);
}
