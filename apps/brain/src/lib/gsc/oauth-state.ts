import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GSC_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type GscOAuthState = {
  storeId: string;
  sub: string;
  nonce: string;
  exp: number;
};

export type GscOAuthStateCode = 'malformed' | 'tampered' | 'expired' | 'replayed' | 'store_mismatch' | 'user_mismatch';

export class GscOAuthStateError extends Error {
  code: GscOAuthStateCode;

  constructor(code: GscOAuthStateCode) {
    super(code);
    this.name = 'GscOAuthStateError';
    this.code = code;
  }
}

const usedNonces = new Map<string, number>();

export function resetGscOAuthStateForTests(): void {
  usedNonces.clear();
}

export function oauthSubjectFromCookie(cookieValue: string): string {
  return createHmac('sha256', 'gsc-oauth-subject').update(cookieValue).digest('base64url');
}

function stateSecret(explicit?: string): string {
  const secret = (explicit ?? process.env.GSC_OAUTH_STATE_SECRET ?? '').trim();
  if (!secret) {
    throw new Error('GSC_OAUTH_STATE_SECRET is required to sign Search Console OAuth state');
  }
  return secret;
}

function signBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function pruneNonces(now: number): void {
  for (const [nonce, exp] of usedNonces) {
    if (exp <= now) usedNonces.delete(nonce);
  }
}

export function signGscOAuthState(
  input: { storeId: string; sub: string },
  options?: { now?: number; ttlMs?: number; secret?: string; nonce?: string },
): string {
  const now = options?.now ?? Date.now();
  const ttl = options?.ttlMs ?? GSC_OAUTH_STATE_TTL_MS;
  const payload: GscOAuthState = {
    storeId: input.storeId,
    sub: input.sub,
    nonce: options?.nonce ?? randomBytes(16).toString('base64url'),
    exp: now + ttl,
  };
  const body = Buffer.from(JSON.stringify({ v: 1, ...payload })).toString('base64url');
  return `${body}.${signBody(body, stateSecret(options?.secret))}`;
}

export function verifyGscOAuthState(
  token: string,
  options?: { now?: number; secret?: string; storeId?: string; sub?: string; consume?: boolean },
): GscOAuthState {
  const now = options?.now ?? Date.now();
  pruneNonces(now);
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) throw new GscOAuthStateError('malformed');
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) throw new GscOAuthStateError('malformed');
  if (!signaturesMatch(sig, signBody(body, stateSecret(options?.secret)))) {
    throw new GscOAuthStateError('tampered');
  }
  let parsed: { v?: number; storeId?: unknown; sub?: unknown; nonce?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new GscOAuthStateError('malformed');
  }
  if (parsed.v !== 1 || typeof parsed.storeId !== 'string' || typeof parsed.sub !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.exp !== 'number') {
    throw new GscOAuthStateError('malformed');
  }
  if (parsed.exp <= now) throw new GscOAuthStateError('expired');
  if (options?.storeId && options.storeId !== parsed.storeId) throw new GscOAuthStateError('store_mismatch');
  if (options?.sub && options.sub !== parsed.sub) throw new GscOAuthStateError('user_mismatch');
  if (usedNonces.has(parsed.nonce)) throw new GscOAuthStateError('replayed');
  if (options?.consume !== false) usedNonces.set(parsed.nonce, parsed.exp);
  return { storeId: parsed.storeId, sub: parsed.sub, nonce: parsed.nonce, exp: parsed.exp };
}
