import { NextResponse } from 'next/server';
import { consoleAuthorized } from '@/lib/console-auth';
import { resolveSiteAds } from '@/lib/ads-site';

export const dynamic = 'force-dynamic';

function adsApiUrl(): string {
  const fromEnv = process.env.ADS_API_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') return '';
  return 'http://127.0.0.1:43180';
}

/** Authenticated export of the filtered client audit log. Not a public route. */
export async function GET(request: Request) {
  if (!(await consoleAuthorized())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const site = await resolveSiteAds();
  if (!site.client) {
    return NextResponse.json({ error: site.error || 'Add a store or site first.' }, { status: 404 });
  }
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const forward = new URLSearchParams(url.searchParams);
  forward.set('format', format);
  forward.delete('cursor');
  const base = adsApiUrl();
  if (!base) {
    return NextResponse.json({ error: 'Ads checks are not connected yet.' }, { status: 503 });
  }
  const headers = new Headers();
  const internalKey = process.env.ADS_INTERNAL_KEY;
  const token = process.env.ADS_API_TOKEN;
  if (internalKey) headers.set('x-cerevex-internal-key', internalKey);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const upstream = await fetch(`${base}/clients/${site.client.id}/audit-log/export?${forward.toString()}`, {
    headers,
    cache: 'no-store',
  });
  const body = await upstream.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = upstream.headers.get('content-type') ?? (format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json');
  responseHeaders.set('content-type', contentType);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) responseHeaders.set('content-disposition', disposition);
  for (const name of ['x-export-truncated', 'x-export-limit']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(body, { status: upstream.status, headers: responseHeaders });
}
