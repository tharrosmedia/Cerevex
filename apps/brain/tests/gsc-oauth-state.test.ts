import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GscOAuthStateError,
  oauthSubjectFromCookie,
  resetGscOAuthStateForTests,
  signGscOAuthState,
  verifyGscOAuthState,
} from '../src/lib/gsc/oauth-state';

const secret = 'test-gsc-state-secret';
const storeId = 'store-1';
const sub = oauthSubjectFromCookie('console-session');
const now = 1_700_000_000_000;

function sign(overrides?: { storeId?: string; sub?: string; ttlMs?: number; now?: number }) {
  return signGscOAuthState(
    { storeId: overrides?.storeId ?? storeId, sub: overrides?.sub ?? sub },
    { secret, now: overrides?.now ?? now, ttlMs: overrides?.ttlMs },
  );
}

resetGscOAuthStateForTests();
{
  const token = sign();
  const verified = verifyGscOAuthState(token, { secret, now: now + 1000, storeId, sub });
  assert.equal(verified.storeId, storeId);
  assert.equal(verified.sub, sub);
}

resetGscOAuthStateForTests();
{
  const token = sign();
  const flipped = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.throws(() => verifyGscOAuthState(flipped, { secret, now }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'tampered';
  });
}

resetGscOAuthStateForTests();
{
  const token = sign({ ttlMs: 1000 });
  assert.throws(() => verifyGscOAuthState(token, { secret, now: now + 1001, storeId, sub }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'expired';
  });
}

resetGscOAuthStateForTests();
{
  const token = sign();
  verifyGscOAuthState(token, { secret, now, storeId, sub });
  assert.throws(() => verifyGscOAuthState(token, { secret, now, storeId, sub }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'replayed';
  });
}

resetGscOAuthStateForTests();
{
  const token = sign();
  assert.throws(() => verifyGscOAuthState(token, { secret, now, storeId: 'store-2', sub }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'store_mismatch';
  });
  const stillGood = verifyGscOAuthState(token, { secret, now, storeId, sub });
  assert.equal(stillGood.storeId, storeId);
}

resetGscOAuthStateForTests();
{
  const token = sign();
  assert.throws(() => verifyGscOAuthState(token, { secret, now, sub: oauthSubjectFromCookie('other') }), (error: unknown) => {
    return error instanceof GscOAuthStateError && error.code === 'user_mismatch';
  });
}

const callback = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/gsc/oauth/callback/route.ts'), 'utf8');
assert.match(callback, /publicRedirect\(/);
assert.doesNotMatch(callback, /state\)\s*;\s*\/\/ storeId/);

console.log('gsc-oauth-state: ok');
