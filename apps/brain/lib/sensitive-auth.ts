import { canApproveApply, DEFAULT_APPROVE_OPERATOR_EMAIL } from '@cerevex/contracts';
import { AUTH_COOKIE_NAME } from './auth-cookie';
import { isProductionRuntime } from './runtime-env';

export const INTERNAL_KEY_HEADER = 'x-cerevex-internal-key';

export type CredentialSource = {
  cookie: string | null;
  internalKey: string | null;
};

export type AuthGate =
  | { ok: true; via: 'session' | 'internal' | 'dev-open' }
  | { ok: false; status: 401 | 403; error: string };

type HeaderReader = { get(name: string): string | null };

type CookieReader = { get(name: string): { value: string } | undefined };

/**
 * Session cookie and the internal-key header only.
 * Query params are ignored so a key cannot be passed on the URL.
 */
export function credentialsFrom(input: {
  headers: HeaderReader;
  cookies?: CookieReader;
  url?: string;
}): CredentialSource {
  const fromJar = input.cookies?.get(AUTH_COOKIE_NAME)?.value ?? null;
  return {
    cookie: fromJar ?? cookieFromHeader(input.headers.get('cookie'), AUTH_COOKIE_NAME),
    internalKey: blankToNull(input.headers.get(INTERNAL_KEY_HEADER)),
  };
}

export function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/** Brain console operator checked against APPROVE_OPERATOR_EMAILS. Defaults to Adam. */
export function consoleOperatorEmail(): string {
  return (process.env.CONSOLE_OPERATOR_EMAIL || DEFAULT_APPROVE_OPERATOR_EMAIL).trim().toLowerCase();
}

/** Equal-length compare. Length mismatches return false without walking the secret. */
export function internalKeyMatches(provided: string | null | undefined): boolean {
  const expected = process.env.ADS_INTERNAL_KEY;
  if (!expected || !provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Any console session, or a valid internal key. Dev without APP_PASSWORD stays open. */
export function authorizeConsole(creds: CredentialSource): AuthGate {
  if (internalKeyMatches(creds.internalKey)) return { ok: true, via: 'internal' };
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (isProductionRuntime()) return { ok: false, status: 401, error: 'Sign in required' };
    return { ok: true, via: 'dev-open' };
  }
  if (creds.cookie === password) return { ok: true, via: 'session' };
  return { ok: false, status: 401, error: 'Sign in required' };
}

/**
 * Approve / apply. Requires the Adam allowlist on a console session, or ADS_INTERNAL_KEY.
 * No dev-open bypass. Query-string keys are not credentials.
 */
export function authorizeApprover(creds: CredentialSource): AuthGate {
  if (internalKeyMatches(creds.internalKey)) return { ok: true, via: 'internal' };
  const password = process.env.APP_PASSWORD;
  if (password && creds.cookie === password) {
    if (!canApproveApply(consoleOperatorEmail())) {
      return { ok: false, status: 403, error: 'Approve is limited to the agency owner allowlist.' };
    }
    return { ok: true, via: 'session' };
  }
  return { ok: false, status: 401, error: 'Sign in required' };
}

export function gateJson(gate: Extract<AuthGate, { ok: false }>): Response {
  return Response.json({ error: gate.error }, { status: gate.status });
}
