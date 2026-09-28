import { NextResponse } from 'next/server';
import { ADS_CHECK_NO_SITE, ADS_SITE_CLIENT_UNAVAILABLE } from '@/lib/ads-copy';
import { adsApi } from '@/lib/ads-bff';
import { consoleAuthorized } from '@/lib/console-auth';
import { publicRedirect } from '@/lib/public-url';
import { resolveSiteAds } from '@/lib/ads-site';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');
  const back = publicRedirect('/ads', request);

  if (!(await consoleAuthorized())) {
    return NextResponse.redirect(publicRedirect('/login', request));
  }
  if (platform !== 'meta' && platform !== 'google') {
    back.searchParams.set('connect_error', 'Choose Meta or Google.');
    return NextResponse.redirect(back);
  }
  let clientId = url.searchParams.get('clientId');
  if (!clientId) {
    const site = await resolveSiteAds();
    clientId = site.client?.id ?? null;
    if (!clientId) {
      const fallback = site.siteId ? ADS_SITE_CLIENT_UNAVAILABLE : ADS_CHECK_NO_SITE;
      back.searchParams.set('connect_error', site.error || fallback);
      return NextResponse.redirect(back);
    }
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
