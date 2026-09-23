import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await adsApi('/funnel/collect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return NextResponse.json(result.ok ? result.data : { error: result.message }, {
    status: result.ok ? 200 : result.status || 400,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
