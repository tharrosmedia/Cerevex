import { NextRequest } from 'next/server';
import { buildAuthUrl, isGscConfigured } from '@/src/lib/gsc/client';

export async function GET(req: NextRequest) {
  if (!isGscConfigured()) {
    return new Response('GSC not configured on host', { status: 400 });
  }
  const storeId = req.nextUrl.searchParams.get('storeId') || '';
  if (!storeId) return new Response('storeId required', { status: 400 });
  const url = buildAuthUrl(storeId);
  return Response.redirect(url);
}
