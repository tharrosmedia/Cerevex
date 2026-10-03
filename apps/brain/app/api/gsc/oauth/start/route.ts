import { NextRequest, NextResponse } from 'next/server';
import { isProductionRuntime } from '@/lib/runtime-env';
import { authorizeConsole, credentialsFrom, gateJson } from '@/lib/sensitive-auth';
import { buildAuthUrl, isGscConfigured } from '@/src/lib/gsc/client';
import {
  GSC_OAUTH_SID_COOKIE,
  GSC_OAUTH_STATE_TTL_MS,
  gscOAuthBind,
  newGscOAuthSid,
  signGscOAuthState,
} from '@/src/lib/gsc/oauth-state';

export async function GET(req: NextRequest) {
  const creds = credentialsFrom({ headers: req.headers, cookies: req.cookies, url: req.url });
  const gate = authorizeConsole(creds);
  if (!gate.ok) return gateJson(gate);
  if (!isGscConfigured()) {
    return new Response('GSC not configured on host', { status: 400 });
  }
  const storeId = req.nextUrl.searchParams.get('storeId') || '';
  if (!storeId) return new Response('storeId required', { status: 400 });
  try {
    const sid = newGscOAuthSid();
    const state = signGscOAuthState({ storeId, bind: gscOAuthBind(sid) });
    const response = NextResponse.redirect(buildAuthUrl(state));
    response.cookies.set({
      name: GSC_OAUTH_SID_COOKIE,
      value: sid,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProductionRuntime(),
      path: '/api/gsc/oauth',
      maxAge: Math.floor(GSC_OAUTH_STATE_TTL_MS / 1000),
    });
    return response;
  } catch (e) {
    console.error('gsc oauth start', e instanceof Error ? e.message : 'state signing failed');
    return new Response('GSC OAuth state is not configured', { status: 500 });
  }
}
