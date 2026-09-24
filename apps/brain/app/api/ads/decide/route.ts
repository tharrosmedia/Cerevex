import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';
import { consoleAuthorized } from '@/lib/console-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(await consoleAuthorized())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    recommendationId?: string;
    action?: string;
    note?: string;
  } | null;
  if (!body?.recommendationId || !body.action) {
    return NextResponse.json({ error: 'recommendationId and action are required' }, { status: 400 });
  }
  if (!['approve', 'authorize', 'deny', 'snooze'].includes(body.action)) {
    return NextResponse.json({ error: 'action must be approve, deny, or snooze' }, { status: 400 });
  }

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
