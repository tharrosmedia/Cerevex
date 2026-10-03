import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { guardApi } from './lib/api-access';
import { AUTH_COOKIE_NAME, setAuthCookie } from './lib/auth-cookie';
import { publicLegalDecision } from './lib/public-paths';
import { credentialsFrom } from './lib/sensitive-auth';

const PASSWORD = process.env.APP_PASSWORD;

function withPathname(request: NextRequest, response: NextResponse) {
  response.headers.set('x-pathname', request.nextUrl.pathname);
  return response;
}

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const next = NextResponse.next({ request: { headers: requestHeaders } });

  const legal = publicLegalDecision(request.nextUrl.pathname);
  if (legal.kind === 'redirect') {
    const url = request.nextUrl.clone();
    url.pathname = legal.pathname;
    return NextResponse.redirect(url, 301);
  }

  if (request.nextUrl.pathname.startsWith('/api')) {
    const creds = credentialsFrom({
      headers: request.headers,
      cookies: request.cookies,
      url: request.url,
    });
    const guard = guardApi(request.nextUrl.pathname, request.method, creds);
    if (guard.kind === 'deny') {
      return NextResponse.json({ error: guard.error }, { status: guard.status });
    }
    return withPathname(request, next);
  }

  if (!PASSWORD) {
    return withPathname(request, next);
  }

  const authCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (authCookie === PASSWORD) {
    const response = withPathname(request, next);
    setAuthCookie(response.cookies, authCookie);
    return response;
  }

  if (request.nextUrl.pathname === '/login' || legal.kind === 'public') {
    return withPathname(request, next);
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /api is included and denied by default. sentry-tunnel stays outside this middleware.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sentry-tunnel).*)'],
};
