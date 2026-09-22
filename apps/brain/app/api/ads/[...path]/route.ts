import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adsApi } from '@/lib/ads-bff';
import { adsProxyPath, isAllowedAdsProxyRequest } from '@/lib/ads-proxy-allowlist';

export const dynamic = 'force-dynamic';

async function consoleAuthorized(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  const jar = await cookies();
  return jar.get('auth')?.value === password;
}

async function handle(request: Request, parts: string[]) {
  if (!(await consoleAuthorized())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  const path = adsProxyPath(parts);
  const url = new URL(request.url);
  const search = url.search;
  if (!isAllowedAdsProxyRequest(request.method, path)) {
    return NextResponse.json({ error: 'Not available in the Ads cockpit.' }, { status: 404 });
  }

  const init: RequestInit = { method: request.method };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.text();
    if (body) init.body = body;
  }

  const result = await adsApi(`${path}${search}`, init);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status || 502 });
  }
  return NextResponse.json(result.data, { status: result.status });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handle(request, path);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handle(request, path);
}
