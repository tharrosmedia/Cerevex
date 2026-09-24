import { NextResponse } from 'next/server';
import { setAuthCookie } from '@/lib/auth-cookie';

const PASSWORD = process.env.APP_PASSWORD;

export async function POST(request: Request) {
  const { password } = await request.json();
  if (PASSWORD && password === PASSWORD) {
    const response = NextResponse.json({ success: true });
    setAuthCookie(response.cookies, password);
    return response;
  }
  return NextResponse.json({ error: 'Invalid' }, { status: 401 });
}
