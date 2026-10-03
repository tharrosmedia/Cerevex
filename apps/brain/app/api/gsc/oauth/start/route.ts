import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth-cookie';
import { authorizeConsole, credentialsFrom, gateJson } from '@/lib/sensitive-auth';
import { buildAuthUrl, isGscConfigured } from '@/src/lib/gsc/client';
import { oauthSubjectFromCookie, signGscOAuthState } from '@/src/lib/gsc/oauth-state';

export async function GET(req: NextRequest) {
  const creds = credentialsFrom({ headers: req.headers, cookies: req.cookies, url: req.url });
  const gate = authorizeConsole(creds);
  if (!gate.ok) return gateJson(gate);
  if (!isGscConfigured()) {
    return new Response('GSC not configured on host', { status: 400 });
  }
  const storeId = req.nextUrl.searchParams.get('storeId') || '';
  if (!storeId) return new Response('storeId required', { status: 400 });
  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value ?? '';
  if (!cookie) return gateJson({ ok: false, status: 401, error: 'Sign in required' });
  try {
    const state = signGscOAuthState({ storeId, sub: oauthSubjectFromCookie(cookie) });
    return Response.redirect(buildAuthUrl(state));
  } catch (e) {
    console.error('gsc oauth start', e instanceof Error ? e.message : e);
    return new Response('GSC OAuth state is not configured', { status: 500 });
  }
}
