import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GSC_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const GSC_OAUTH_SID_COOKIE = 'gsc_oauth_sid';

export type GscOAuthState = {
  storeId: string;
  /** HMAC of the httpOnly sid. Not a password, cookie, or session secret. */
  bind: string;
  nonce: string;
  exp: number;
};

export type GscOAuthStateCode = 'malformed' | 'tampered' | 'expired' | 'replayed' | 'store_mismatch' | 'bind_mismatch';

export class GscOAuthStateError extends Error {
  code: GscOAuthStateCode;

  constructor(code: GscOAuthStateCode) {
    super(code);
    this.name = 'GscOAuthStateError';
    this.code = code;
  }
}

/**
 * Single-use nonces are stored in this process only.
 * Another Brain instance can accept a state it has not seen, so replay protection is not shared across replicas.
 * Google's authorization code is also single-use, which limits that window. A shared store is not part of this change.
 */
const usedNonces = new Map<string, number>();

export function resetGscOAuthStateForTests(): void {
  usedNonces.clear();
}

export function newGscOAuthSid(): string {
  return randomBytes(32).toString('base64url');
}

function stateSecret(explicit?: string): string {
  const secret = explicit ?? process.env.GSC_OAUTH_STATE_SECRET ?? '';
  if (!secret.trim()) {
    throw new Error('GSC_OAUTH_STATE_SECRET is required to sign Search Console OAuth state');
  }
  if (secret !== secret.trim()) {
    throw new Error('GSC_OAUTH_STATE_SECRET has leading or trailing whitespace.');
  }
  return secret;
}

/** Bind a random sid. The password and the sid itself never enter the Google URL. */
export function gscOAuthBind(sid: string, explicitSecret?: string): string {
  return createHmac('sha256', stateSecret(explicitSecret)).update(`gsc-oauth-bind:${sid}`).digest('base64url');
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
  input: { storeId: string; bind: string },
  options?: { now?: number; ttlMs?: number; secret?: string; nonce?: string },
): string {
  const now = options?.now ?? Date.now();
  const ttl = options?.ttlMs ?? GSC_OAUTH_STATE_TTL_MS;
  const payload: GscOAuthState = {
    storeId: input.storeId,
    bind: input.bind,
    nonce: options?.nonce ?? randomBytes(16).toString('base64url'),
    exp: now + ttl,
  };
  const body = Buffer.from(JSON.stringify({ v: 1, ...payload })).toString('base64url');
  return `${body}.${signBody(body, stateSecret(options?.secret))}`;
}

export function verifyGscOAuthState(
  token: string,
  options?: { now?: number; secret?: string; storeId?: string; bind?: string; consume?: boolean },
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
  let parsed: { v?: number; storeId?: unknown; bind?: unknown; nonce?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new GscOAuthStateError('malformed');
  }
  if (parsed.v !== 1 || typeof parsed.storeId !== 'string' || typeof parsed.bind !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.exp !== 'number') {
    throw new GscOAuthStateError('malformed');
  }
  if (parsed.exp <= now) throw new GscOAuthStateError('expired');
  if (options?.storeId && options.storeId !== parsed.storeId) throw new GscOAuthStateError('store_mismatch');
  if (options?.bind && !signaturesMatch(options.bind, parsed.bind)) throw new GscOAuthStateError('bind_mismatch');
  if (usedNonces.has(parsed.nonce)) throw new GscOAuthStateError('replayed');
  if (options?.consume !== false) usedNonces.set(parsed.nonce, parsed.exp);
  return { storeId: parsed.storeId, bind: parsed.bind, nonce: parsed.nonce, exp: parsed.exp };
}
