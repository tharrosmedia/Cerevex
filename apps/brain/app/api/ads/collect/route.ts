import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';
import { adsCollectCorsHeaders, inspectAdsCollectRequest } from '@/lib/ads-collect';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: adsCollectCorsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const decision = await inspectAdsCollectRequest(request);
  const headers = adsCollectCorsHeaders(decision.origin);
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status, headers });
  }
  const result = await adsApi('/funnel/collect', {
    method: 'POST',
    body: JSON.stringify(decision.body),
  });
  return NextResponse.json(result.ok ? result.data : { error: 'collect failed' }, {
    status: result.ok ? 200 : result.status || 400,
    headers,
  });
}
