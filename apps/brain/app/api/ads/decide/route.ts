import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';

export const dynamic = 'force-dynamic';

async function consoleAuthorized(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  const jar = await cookies();
  return jar.get('auth')?.value === password;
}

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
