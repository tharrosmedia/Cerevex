import { NextResponse } from 'next/server';

const PASSWORD = process.env.APP_PASSWORD;

export async function POST(request: Request) {
  const { password } = await request.json();
  if (PASSWORD && password === PASSWORD) {
    const response = NextResponse.json({ success: true });
    response.cookies.set('auth', password, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return response;
  }
  return NextResponse.json({ error: 'Invalid' }, { status: 401 });
}
