/** Shared Brain console session cookie. Value remains APP_PASSWORD (unchanged contract). */
export const AUTH_COOKIE_NAME = 'auth';

/** 3-day sliding idle. Re-set on each authenticated request. */
export const AUTH_IDLE_MAX_AGE = 60 * 60 * 24 * 3;

export type AuthCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
};

export function authCookieOptions(): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_IDLE_MAX_AGE,
  };
}

export type AuthCookieWriter = {
  set: (name: string, value: string, options?: AuthCookieOptions) => unknown;
};

export type AuthCookieClearer = {
  delete: (cookie: { name: string; path: string }) => unknown;
};

export function setAuthCookie(store: AuthCookieWriter, value: string) {
  store.set(AUTH_COOKIE_NAME, value, authCookieOptions());
}

export function clearAuthCookie(store: AuthCookieClearer) {
  store.delete({ name: AUTH_COOKIE_NAME, path: '/' });
}
