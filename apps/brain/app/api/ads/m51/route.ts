import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';
import { consoleAuthorized } from '@/lib/console-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!(await consoleAuthorized())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    op?: string;
    clientId?: string;
    entityId?: string;
    targetPlatform?: string;
    ideaId?: string;
    adAccountId?: string;
    connectorId?: string;
    propertyId?: string;
    measurementId?: string;
    id?: string;
  } | null;
  if (!body?.op) {
    return NextResponse.json({ error: 'op is required' }, { status: 400 });
  }

  if (body.op === 'generate') {
    const result = await adsApi('/brainstorm/generate', {
      method: 'POST',
      body: JSON.stringify({
        clientId: body.clientId,
        entityId: body.entityId,
        targetPlatform: body.targetPlatform,
      }),
    });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status || 502 });
    return NextResponse.json(result.data, { status: result.status });
  }

  if (body.op === 'promote') {
    const result = await adsApi('/brainstorm/promote', {
      method: 'POST',
      body: JSON.stringify({
        clientId: body.clientId,
        ideaId: body.ideaId,
        adAccountId: body.adAccountId,
      }),
    });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status || 502 });
    return NextResponse.json(result.data, { status: result.status });
  }

  if (body.op === 'funnel_connect') {
    const result = await adsApi('/funnel/connect', {
      method: 'POST',
      body: JSON.stringify({
        clientId: body.clientId,
        connectorId: body.connectorId,
        propertyId: body.propertyId,
        measurementId: body.measurementId,
      }),
    });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status || 502 });
    return NextResponse.json(result.data, { status: result.status });
  }

  if (body.op === 'funnel_disconnect') {
    const result = await adsApi('/funnel/disconnect', {
      method: 'POST',
      body: JSON.stringify({ id: body.id }),
    });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status || 502 });
    return NextResponse.json(result.data, { status: result.status });
  }

  return NextResponse.json({ error: 'Unknown op' }, { status: 400 });
}
