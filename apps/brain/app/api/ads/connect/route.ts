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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  const clientId = url.searchParams.get('clientId');
  const back = new URL('/ads', url.origin);
  if (clientId) back.searchParams.set('client', clientId);

  if (!(await consoleAuthorized())) {
    return NextResponse.redirect(new URL('/login', url.origin));
  }
  if (platform !== 'meta' && platform !== 'google') {
    back.searchParams.set('connect_error', 'Choose Meta or Google.');
    return NextResponse.redirect(back);
  }
  if (!clientId) {
    back.searchParams.set('connect_error', 'Choose a client first.');
    return NextResponse.redirect(back);
  }

  const started = await adsApi<{ url: string }>(
    `/oauth/${platform}/start?clientId=${encodeURIComponent(clientId)}`,
  );
  if (started.ok && started.data.url) {
    return NextResponse.redirect(started.data.url);
  }

  const fallback = `Could not start ${platform === 'meta' ? 'Meta' : 'Google'} connect.`;
  back.searchParams.set('connect_error', started.ok ? fallback : started.message || fallback);
  return NextResponse.redirect(back);
}
