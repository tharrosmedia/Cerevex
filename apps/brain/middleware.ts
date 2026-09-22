import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PASSWORD = process.env.APP_PASSWORD;

export function middleware(request: NextRequest) {
  if (!PASSWORD) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get('auth')?.value;

  if (authCookie === PASSWORD) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname === '/login') {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Exclude Sentry tunnel route + example test pages from auth middleware
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sentry-tunnel|sentry-example-page|api/sentry-example-api).*)'],
};
