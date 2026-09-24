import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, setAuthCookie, type AuthCookieWriter } from '@/lib/auth-cookie';

/**
 * Brain console gate used by /api/ads/* route handlers.
 * On a valid auth cookie, refresh the 3-day sliding idle.
 */
export async function consoleAuthorized(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  const jar = await cookies();
  const value = jar.get(AUTH_COOKIE_NAME)?.value;
  if (value !== password) return false;
  setAuthCookie(jar as unknown as AuthCookieWriter, value);
  return true;
}
