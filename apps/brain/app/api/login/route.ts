import { NextResponse } from 'next/server';
import { setAuthCookie } from '@/lib/auth-cookie';
import { passwordMatches } from '@/lib/sensitive-auth';

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: '' }));
  if (passwordMatches(typeof password === 'string' ? password : '')) {
    const response = NextResponse.json({ success: true });
    setAuthCookie(response.cookies, password);
    return response;
  }
  return NextResponse.json({ error: 'Invalid' }, { status: 401 });
}
