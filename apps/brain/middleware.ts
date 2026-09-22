import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PASSWORD = process.env.APP_PASSWORD;

function withPathname(request: NextRequest, response: NextResponse) {
  response.headers.set('x-pathname', request.nextUrl.pathname);
  return response;
}

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const next = NextResponse.next({ request: { headers: requestHeaders } });

  if (!PASSWORD) {
    return withPathname(request, next);
  }

  const authCookie = request.cookies.get('auth')?.value;

  if (authCookie === PASSWORD) {
    return withPathname(request, next);
  }

  if (request.nextUrl.pathname === '/login') {
    return withPathname(request, next);
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Exclude Sentry tunnel route + example test pages from auth middleware
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sentry-tunnel|sentry-example-page|api/sentry-example-api).*)'],
};
